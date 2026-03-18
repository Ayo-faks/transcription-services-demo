import type { ClinicalSummaryResponse } from '../../shared/types/api'

export interface ClinicalSummarySection {
  title: string
  paragraphs: string[]
  bullets: string[]
  tableHeader: string[]
  tableRows: string[][]
}

export interface ClinicalSummarySignals {
  headline: string | null
  medicationChanges: string[]
  followUpItems: string[]
  testsOrdered: string[]
  referrals: string[]
  patientInstructions: string[]
}

function dedupeLines(lines: string[]) {
  const seen = new Set<string>()

  return lines.filter((line) => {
    const normalized = line.trim().toLowerCase()
    if (!normalized || seen.has(normalized)) {
      return false
    }

    seen.add(normalized)
    return true
  })
}

function flattenSectionLines(section: ClinicalSummarySection) {
  return [...section.paragraphs, ...section.bullets, ...section.tableHeader, ...section.tableRows.flat()]
    .map((line) => line.trim())
    .filter(Boolean)
}

function cleanInlineMarkdown(text: string) {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*(?!\s)([^*]+)\*/g, '$1')
    .replace(/_(?!\s)([^_]+)_/g, '$1')
    .replace(/\\([|*_`#])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanHeadingText(text: string) {
  return cleanInlineMarkdown(text.replace(/^#+\s*/, '').replace(/^#+\s*/, '').trim())
}

function parseTableRow(line: string) {
  return line
    .split('|')
    .map((cell) => cleanInlineMarkdown(cell))
    .filter(Boolean)
}

function isMarkdownTableLine(line: string) {
  return line.includes('|') && line.split('|').length >= 3
}

function isTableDivider(line: string) {
  const compact = line.replace(/\|/g, '').trim()
  return compact.length > 0 && /^[:\-\s]+$/.test(compact)
}

function createSection(title: string): ClinicalSummarySection {
  return {
    title,
    paragraphs: [],
    bullets: [],
    tableHeader: [],
    tableRows: [],
  }
}

function titleMatches(section: ClinicalSummarySection, keywords: string[]) {
  const title = section.title.toLowerCase()
  return keywords.some((keyword) => title.includes(keyword))
}

function lineMatches(line: string, keywords: string[]) {
  const normalized = line.toLowerCase()
  return keywords.some((keyword) => normalized.includes(keyword))
}

function collectLines(sections: ClinicalSummarySection[], keywords: string[]) {
  const matches = sections.flatMap((section) => {
    const lines = flattenSectionLines(section)
    if (titleMatches(section, keywords)) {
      return lines.length > 0 ? lines : [section.title]
    }

    return lines.filter((line) => lineMatches(line, keywords))
  })

  return dedupeLines(matches)
}

function getHeadline(sections: ClinicalSummarySection[], summary: ClinicalSummaryResponse) {
  for (const section of sections) {
    const lead = [...section.paragraphs, ...section.bullets].find(Boolean)
    if (lead) {
      return lead
    }
  }

  const firstLine = summary.summary_text
    ?.split('\n')
    .map((line) => cleanInlineMarkdown(line.trim()))
    .find((line) => Boolean(line) && !line.startsWith('#') && !line.startsWith('|'))

  return firstLine || null
}

export function parseClinicalSummary(summary: ClinicalSummaryResponse | null) {
  if (!summary || !summary.summary_text) {
    return [] as ClinicalSummarySection[]
  }

  const lines = summary.summary_text.split('\n')
  const sections: ClinicalSummarySection[] = []
  let activeSection = createSection('Overview')

  function pushActiveSection() {
    if (
      activeSection.paragraphs.length > 0
      || activeSection.bullets.length > 0
      || activeSection.tableHeader.length > 0
      || activeSection.tableRows.length > 0
    ) {
      sections.push(activeSection)
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index].trim()
    if (!rawLine) {
      continue
    }

    const headingMatch = rawLine.match(/^#{1,6}\s+(.+)$/)
    if (headingMatch) {
      const heading = cleanHeadingText(headingMatch[1])
      if (/^clinical summary$/i.test(heading)) {
        continue
      }

      pushActiveSection()
      activeSection = createSection(heading)
      continue
    }

    if (isMarkdownTableLine(rawLine)) {
      const parsedRow = parseTableRow(rawLine)
      const nextLine = lines[index + 1]?.trim() || ''
      if (parsedRow.length > 0 && activeSection.tableHeader.length === 0 && isTableDivider(nextLine)) {
        activeSection.tableHeader = parsedRow
        index += 1
        continue
      }

      if (parsedRow.length > 0 && !isTableDivider(rawLine)) {
        activeSection.tableRows.push(parsedRow)
      }
      continue
    }

    const bulletMatch = rawLine.match(/^[-*•]\s+(.+)$/)
    if (bulletMatch) {
      activeSection.bullets.push(cleanInlineMarkdown(bulletMatch[1]))
      continue
    }

    activeSection.paragraphs.push(cleanInlineMarkdown(rawLine))
  }

  pushActiveSection()
  return sections
}

export function extractClinicalSummarySignals(summary: ClinicalSummaryResponse | null): ClinicalSummarySignals {
  const sections = parseClinicalSummary(summary)

  return {
    headline: summary ? getHeadline(sections, summary) : null,
    medicationChanges: collectLines(sections, ['medication', 'rx', 'prescription']),
    followUpItems: collectLines(sections, ['follow-up', 'follow up', 'next step', 'plan', 'return']),
    testsOrdered: collectLines(sections, ['test', 'lab', 'imaging', 'investigation', 'screen']),
    referrals: collectLines(sections, ['referral', 'specialist', 'handoff', 'consult']),
    patientInstructions: collectLines(sections, ['instruction', 'advice', 'education', 'safety net']),
  }
}