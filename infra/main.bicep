// Azure Bicep deployment template for Healthcare Transcription Services
// Deploy with: az deployment group create --resource-group <rg-name> --template-file main.bicep
// 
// This template uses managed identity authentication for all services
// to comply with enterprise security policies (disableLocalAuth: true)

@description('The location for all resources')
param location string = resourceGroup().location

@description('Base name for all resources')
param baseName string = 'healthtranscript'

@description('Environment (dev, staging, prod)')
@allowed(['dev', 'staging', 'prod'])
param environment string = 'dev'

@description('Allowed browser origin for CORS.')
param allowedOrigin string = ''

@description('Microsoft Entra app registration client ID for Easy Auth.')
param microsoftProviderClientId string = ''

@description('Key Vault reference value for the Microsoft provider client secret app setting.')
@secure()
param microsoftProviderClientSecretReference string = ''

@description('Google OAuth client ID for Easy Auth.')
param googleProviderClientId string = ''

@description('Key Vault reference value for the Google provider client secret app setting.')
@secure()
param googleProviderClientSecretReference string = ''

@description('Optional default tenant ID used to auto-assign first-time users in bootstrap flows.')
param defaultTenantId string = ''

@description('Days after modification before encounter audio moves to the Cool tier.')
param audioBlobCoolTierDays int = 30

@description('Days after modification before encounter audio moves to the Archive tier.')
param audioBlobArchiveTierDays int = 180

@description('Days after modification before encounter audio is deleted.')
param audioBlobDeleteDays int = 2920

// Generate unique suffix for globally unique names
var uniqueSuffix = uniqueString(resourceGroup().id)
var resourceBaseName = '${baseName}-${environment}'
var easyAuthEnabled = !empty(microsoftProviderClientId) || !empty(googleProviderClientId)
var frontendStorageAccountName = toLower('${take(baseName, 10)}${take(uniqueSuffix, 8)}web')
var derivedFrontendOrigin = 'https://${frontendStorageAccountName}.z33.web.${az.environment().suffixes.storage}'
var effectiveAllowedOrigin = empty(allowedOrigin) ? derivedFrontendOrigin : allowedOrigin

// Role definition IDs for RBAC
var storageBlobDataOwnerRoleId = 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
var storageQueueDataContributorRoleId = '974c5e8b-45b9-4653-ba55-5f855dd0fb88'
var cognitiveServicesUserRoleId = 'a97b65f3-24c7-4388-baec-2e87135dc908'
var cognitiveServicesOpenAIUserRoleId = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd' // Cognitive Services OpenAI User
var cosmosDbDataContributorRoleId = '00000000-0000-0000-0000-000000000002' // Cosmos DB Built-in Data Contributor
var searchServiceContributorRoleId = '7ca78c08-252a-4471-8644-bb5ff32d4ba0'
var searchIndexDataContributorRoleId = '8ebe5a00-799e-43f5-93ac-243d3dce84a7'
var searchIndexDataReaderRoleId = '1407120a-92aa-4202-b7e9-c0e197c71c8f'

// ============================================================================
// Storage Account - For audio files and function app
// ============================================================================
resource storageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: toLower('${take(baseName, 10)}${take(uniqueSuffix, 8)}st')
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  tags: {
    workload: 'healthtranscribe'
    role: 'backend-storage'
    environment: environment
  }
  properties: {
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    allowSharedKeyAccess: true // Required for AzureWebJobsStorage
    publicNetworkAccess: 'Enabled' // Required for Function App access without VNet
    encryption: {
      services: {
        blob: { enabled: true }
        queue: { enabled: true }
      }
      keySource: 'Microsoft.Storage'
    }
  }
}

// Blob container for audio files
resource audioContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  name: '${storageAccount.name}/default/audio-files'
  properties: {
    publicAccess: 'None'
  }
}

resource storageLifecyclePolicy 'Microsoft.Storage/storageAccounts/managementPolicies@2023-01-01' = {
  parent: storageAccount
  name: 'default'
  properties: {
    policy: {
      rules: [
        {
          name: 'encounter-audio-tier-and-retain'
          enabled: true
          type: 'Lifecycle'
          definition: {
            actions: {
              baseBlob: {
                tierToCool: {
                  daysAfterModificationGreaterThan: audioBlobCoolTierDays
                }
                tierToArchive: {
                  daysAfterModificationGreaterThan: audioBlobArchiveTierDays
                }
                delete: {
                  daysAfterModificationGreaterThan: audioBlobDeleteDays
                }
              }
            }
            filters: {
              blobTypes: [
                'blockBlob'
              ]
              prefixMatch: [
                'encounters/'
              ]
            }
          }
        }
      ]
    }
  }
}

// Dedicated frontend storage account for UK-only static website hosting
resource frontendStorageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: frontendStorageAccountName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  tags: {
    workload: 'healthtranscribe'
    role: 'frontend-static-site'
    environment: environment
  }
  properties: {
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    allowSharedKeyAccess: false
    allowBlobPublicAccess: false
    publicNetworkAccess: 'Enabled'
    encryption: {
      services: {
        blob: { enabled: true }
      }
      keySource: 'Microsoft.Storage'
    }
  }
}

// ============================================================================
// Cosmos DB - For storing transcription jobs and results
// ============================================================================
resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2023-11-15' = {
  name: '${resourceBaseName}-cosmos-${take(uniqueSuffix, 6)}'
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    disableLocalAuth: true // Enforce managed identity auth
    publicNetworkAccess: 'Enabled' // Required for Function App access without VNet
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    capabilities: [
      { name: 'EnableServerless' }
    ]
  }
}

resource cosmosDatabase 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2023-11-15' = {
  parent: cosmosAccount
  name: 'transcription-db'
  properties: {
    resource: { id: 'transcription-db' }
  }
}

resource cosmosContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2023-11-15' = {
  parent: cosmosDatabase
  name: 'transcriptions'
  properties: {
    resource: {
      id: 'transcriptions'
      partitionKey: {
        paths: ['/id']
        kind: 'Hash'
      }
      indexingPolicy: {
        compositeIndexes: [
          [
            {
              path: '/tenant_id'
              order: 'ascending'
            }
            {
              path: '/created_at'
              order: 'descending'
            }
          ]
        ]
      }
    }
  }
}

resource platformUsersContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2023-11-15' = {
  parent: cosmosDatabase
  name: 'platform_users'
  properties: {
    resource: {
      id: 'platform_users'
      partitionKey: {
        paths: ['/issuer_subject']
        kind: 'Hash'
      }
    }
  }
}

resource platformTenantsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2023-11-15' = {
  parent: cosmosDatabase
  name: 'platform_tenants'
  properties: {
    resource: {
      id: 'platform_tenants'
      partitionKey: {
        paths: ['/id']
        kind: 'Hash'
      }
    }
  }
}

resource platformVoiceSessionsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2023-11-15' = {
  parent: cosmosDatabase
  name: 'platform_voice_sessions'
  properties: {
    resource: {
      id: 'platform_voice_sessions'
      partitionKey: {
        paths: ['/id']
        kind: 'Hash'
      }
      defaultTtl: 900
    }
  }
}

resource platformAuditLogContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2023-11-15' = {
  parent: cosmosDatabase
  name: 'platform_audit_log'
  properties: {
    resource: {
      id: 'platform_audit_log'
      partitionKey: {
        paths: ['/tenant_id']
        kind: 'Hash'
      }
    }
  }
}

// ============================================================================
// Cognitive Services - Speech Services (with managed identity)
// ============================================================================
resource speechService 'Microsoft.CognitiveServices/accounts@2023-10-01-preview' = {
  name: '${resourceBaseName}-speech-${take(uniqueSuffix, 6)}'
  location: location
  kind: 'SpeechServices'
  sku: { name: 'S0' }
  properties: {
    customSubDomainName: '${resourceBaseName}-speech-${take(uniqueSuffix, 6)}'
    publicNetworkAccess: 'Enabled'
    disableLocalAuth: true // Enforce managed identity auth
  }
}

// ============================================================================
// Cognitive Services - Language Service (Text Analytics for Health)
// ============================================================================
resource languageService 'Microsoft.CognitiveServices/accounts@2023-10-01-preview' = {
  name: '${resourceBaseName}-lang-${take(uniqueSuffix, 6)}'
  location: location
  kind: 'TextAnalytics'
  sku: { name: 'S' } // Standard tier for Text Analytics for Health
  properties: {
    customSubDomainName: '${resourceBaseName}-lang-${take(uniqueSuffix, 6)}'
    publicNetworkAccess: 'Enabled'
    disableLocalAuth: true // Enforce managed identity auth
  }
}

// ============================================================================
// Azure OpenAI Service - For AI-powered clinical summaries
// ============================================================================
resource openAIService 'Microsoft.CognitiveServices/accounts@2023-10-01-preview' = {
  name: '${resourceBaseName}-openai-${take(uniqueSuffix, 6)}'
  location: location
  kind: 'OpenAI'
  sku: { name: 'S0' }
  properties: {
    customSubDomainName: '${resourceBaseName}-openai-${take(uniqueSuffix, 6)}'
    publicNetworkAccess: 'Enabled'
    disableLocalAuth: true // Enforce managed identity auth
  }
}

// ============================================================================
// Azure AI Search - Encounter-local retrieval backend
// ============================================================================
resource searchService 'Microsoft.Search/searchServices@2023-11-01' = {
  name: '${resourceBaseName}-search-${take(uniqueSuffix, 6)}'
  location: location
  sku: {
    name: 'basic'
  }
  properties: {
    hostingMode: 'default'
    publicNetworkAccess: 'enabled'
    replicaCount: 1
    partitionCount: 1
  }
  tags: {
    workload: 'healthtranscribe'
    role: 'clinical-context-retrieval'
    environment: environment
  }
}

// Deploy GPT-4o-mini model for clinical summaries
resource gpt4oMiniDeployment 'Microsoft.CognitiveServices/accounts/deployments@2023-10-01-preview' = {
  parent: openAIService
  name: 'gpt-4o-mini'
  sku: {
    name: 'GlobalStandard'
    capacity: 10 // 10K tokens per minute
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'gpt-4o-mini'
      version: '2024-07-18'
    }
    raiPolicyName: 'Microsoft.DefaultV2'
  }
}

// ============================================================================
// App Service Plan - Elastic Premium for managed identity storage binding
// ============================================================================
resource appServicePlan 'Microsoft.Web/serverfarms@2023-01-01' = {
  name: '${resourceBaseName}-plan-${take(uniqueSuffix, 6)}'
  location: location
  sku: {
    name: 'EP1'
    tier: 'ElasticPremium'
    family: 'EP'
  }
  kind: 'elastic'
  properties: {
    reserved: true // Linux
    maximumElasticWorkerCount: 20
  }
}

// ============================================================================
// Application Insights - For monitoring
// ============================================================================
resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${resourceBaseName}-insights-${take(uniqueSuffix, 6)}'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    Request_Source: 'rest'
  }
}

// ============================================================================
// Function App - Backend API with System Assigned Managed Identity
// ============================================================================
resource functionApp 'Microsoft.Web/sites@2023-01-01' = {
  name: '${resourceBaseName}-func-${take(uniqueSuffix, 6)}'
  location: location
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      pythonVersion: '3.11'
      linuxFxVersion: 'Python|3.11'
      cors: {
        allowedOrigins: [effectiveAllowedOrigin]
      }
      appSettings: [
        // Storage - Managed Identity binding
        { name: 'AzureWebJobsStorage__accountName', value: storageAccount.name }
        // Functions runtime
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
        { name: 'FUNCTIONS_WORKER_RUNTIME', value: 'python' }
        // Application Insights
        { name: 'APPINSIGHTS_INSTRUMENTATIONKEY', value: appInsights.properties.InstrumentationKey }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
        // Speech Service - Managed Identity (no keys)
        { name: 'AZURE_SPEECH_ENDPOINT', value: speechService.properties.endpoint }
        { name: 'AZURE_SPEECH_REGION', value: location }
        // Language Service - Managed Identity (no keys)
        { name: 'AZURE_LANGUAGE_ENDPOINT', value: languageService.properties.endpoint }
        // Azure OpenAI - Managed Identity (no keys)
        { name: 'AZURE_OPENAI_ENDPOINT', value: openAIService.properties.endpoint }
        { name: 'AZURE_OPENAI_DEPLOYMENT', value: gpt4oMiniDeployment.name }
        { name: 'AZURE_OPENAI_EMBEDDING_DEPLOYMENT', value: 'text-embedding-3-small' }
        { name: 'AZURE_OPENAI_EMBEDDING_MODEL', value: 'text-embedding-3-small' }
        { name: 'AZURE_OPENAI_EMBEDDING_DIMENSIONS', value: '1536' }
        // Azure AI Search - Managed Identity
        { name: 'AZURE_SEARCH_ENDPOINT', value: 'https://${searchService.name}.search.windows.net' }
        { name: 'AZURE_SEARCH_INDEX_NAME', value: 'clinical-context' }
        // Cosmos DB - Managed Identity (no connection string)
        { name: 'COSMOS_ENDPOINT', value: cosmosAccount.properties.documentEndpoint }
        { name: 'COSMOS_DATABASE_NAME', value: cosmosDatabase.name }
        { name: 'COSMOS_CONTAINER_NAME', value: cosmosContainer.name }
        { name: 'PLATFORM_USERS_CONTAINER_NAME', value: platformUsersContainer.name }
        { name: 'PLATFORM_TENANTS_CONTAINER_NAME', value: platformTenantsContainer.name }
        { name: 'PLATFORM_VOICE_SESSIONS_CONTAINER_NAME', value: platformVoiceSessionsContainer.name }
        { name: 'PLATFORM_AUDIT_LOG_CONTAINER_NAME', value: platformAuditLogContainer.name }
        // Storage for blob operations
        { name: 'STORAGE_ACCOUNT_NAME', value: storageAccount.name }
        { name: 'STORAGE_CONTAINER_NAME', value: 'audio-files' }
        { name: 'DEFAULT_TENANT_ID', value: defaultTenantId }
        { name: 'MICROSOFT_PROVIDER_AUTHENTICATION_SECRET', value: microsoftProviderClientSecretReference }
        { name: 'GOOGLE_PROVIDER_AUTHENTICATION_SECRET', value: googleProviderClientSecretReference }
        // Build settings
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'false' }
        { name: 'ENABLE_ORYX_BUILD', value: 'false' }
        { name: 'WEBSITE_RUN_FROM_PACKAGE', value: '1' }
        { name: 'AzureWebJobsFeatureFlags', value: 'EnableWorkerIndexing' }
      ]
    }
  }
}

resource functionAppAuth 'Microsoft.Web/sites/config@2022-09-01' = {
  parent: functionApp
  name: 'authsettingsV2'
  properties: {
    platform: {
      enabled: easyAuthEnabled
      runtimeVersion: '~1'
    }
    globalValidation: {
      requireAuthentication: easyAuthEnabled
      unauthenticatedClientAction: 'Return401'
      excludedPaths: [
        '/api/health'
      ]
    }
    httpSettings: {
      requireHttps: true
      routes: {
        apiPrefix: '/.auth'
      }
    }
    login: {
      tokenStore: {
        enabled: true
      }
    }
    identityProviders: {
      azureActiveDirectory: {
        enabled: !empty(microsoftProviderClientId)
        login: {
          loginParameters: [
            'scope=openid profile email'
          ]
        }
        registration: {
          clientId: microsoftProviderClientId
          clientSecretSettingName: 'MICROSOFT_PROVIDER_AUTHENTICATION_SECRET'
          openIdIssuer: '${az.environment().authentication.loginEndpoint}organizations/v2.0'
        }
      }
      google: {
        enabled: !empty(googleProviderClientId)
        login: {
          scopes: [
            'openid'
            'profile'
            'email'
          ]
        }
        registration: {
          clientId: googleProviderClientId
          clientSecretSettingName: 'GOOGLE_PROVIDER_AUTHENTICATION_SECRET'
        }
      }
    }
  }
}

// Enable SCM basic auth for deployment (required for GitHub Actions)
resource functionAppScmBasicAuth 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2023-01-01' = {
  parent: functionApp
  name: 'scm'
  properties: { allow: true }
}

resource functionAppFtpBasicAuth 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2023-01-01' = {
  parent: functionApp
  name: 'ftp'
  properties: { allow: true }
}

// ============================================================================
// RBAC - Storage Blob Data Owner (for blob operations)
// ============================================================================
resource storageBlobDataOwnerRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccount.id, functionApp.id, storageBlobDataOwnerRoleId)
  scope: storageAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataOwnerRoleId)
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// ============================================================================
// RBAC - Storage Queue Data Contributor (for function triggers)
// ============================================================================
resource storageQueueDataContributorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccount.id, functionApp.id, storageQueueDataContributorRoleId)
  scope: storageAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageQueueDataContributorRoleId)
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// ============================================================================
// RBAC - Cognitive Services User for Speech Service
// ============================================================================
resource speechServiceRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(speechService.id, functionApp.id, cognitiveServicesUserRoleId)
  scope: speechService
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', cognitiveServicesUserRoleId)
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// ============================================================================
// RBAC - Cognitive Services User for Language Service
// ============================================================================
resource languageServiceRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(languageService.id, functionApp.id, cognitiveServicesUserRoleId)
  scope: languageService
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', cognitiveServicesUserRoleId)
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// ============================================================================
// RBAC - Cognitive Services OpenAI User for Azure OpenAI
// ============================================================================
resource openAIServiceRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(openAIService.id, functionApp.id, cognitiveServicesOpenAIUserRoleId)
  scope: openAIService
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', cognitiveServicesOpenAIUserRoleId)
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// ============================================================================
// RBAC - Cosmos DB Data Contributor
// ============================================================================
resource cosmosDbRole 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2023-11-15' = {
  parent: cosmosAccount
  name: guid(cosmosAccount.id, functionApp.id, cosmosDbDataContributorRoleId)
  properties: {
    roleDefinitionId: '${cosmosAccount.id}/sqlRoleDefinitions/${cosmosDbDataContributorRoleId}'
    principalId: functionApp.identity.principalId
    scope: cosmosAccount.id
  }
}

// ============================================================================
// RBAC - Azure AI Search data-plane and index management access
// ============================================================================
resource searchServiceContributorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(searchService.id, functionApp.id, searchServiceContributorRoleId)
  scope: searchService
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', searchServiceContributorRoleId)
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource searchIndexDataContributorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(searchService.id, functionApp.id, searchIndexDataContributorRoleId)
  scope: searchService
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', searchIndexDataContributorRoleId)
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource searchIndexDataReaderRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(searchService.id, functionApp.id, searchIndexDataReaderRoleId)
  scope: searchService
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', searchIndexDataReaderRoleId)
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// ============================================================================
// Outputs - Used by GitHub Actions for deployment
// ============================================================================
output functionAppName string = functionApp.name
output functionAppUrl string = 'https://${functionApp.properties.defaultHostName}'
output frontendStorageAccountName string = frontendStorageAccount.name
output frontendWebsiteUrl string = frontendStorageAccount.properties.primaryEndpoints.web
output effectiveAllowedOrigin string = effectiveAllowedOrigin
output speechServiceEndpoint string = speechService.properties.endpoint
output languageServiceEndpoint string = languageService.properties.endpoint
output openAIServiceEndpoint string = openAIService.properties.endpoint
output openAIDeploymentName string = gpt4oMiniDeployment.name
output searchServiceEndpoint string = 'https://${searchService.name}.search.windows.net'
output searchIndexName string = 'clinical-context'
output cosmosAccountEndpoint string = cosmosAccount.properties.documentEndpoint
output storageAccountName string = storageAccount.name
output resourceGroup string = resourceGroup().name
