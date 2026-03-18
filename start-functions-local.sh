#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_PYTHON="${PROJECT_ROOT}/.venv/bin/python"
FUNC_BIN="${PROJECT_ROOT}/node_modules/.bin/func"
DEFAULT_PORT="${FUNCTIONS_LOCAL_PORT:-7072}"

if [[ ! -x "${VENV_PYTHON}" ]]; then
    echo "Expected project virtual environment interpreter at ${VENV_PYTHON}" >&2
    echo "Create the virtual environment and install requirements before starting Functions." >&2
    exit 1
fi

if [[ ! -x "${FUNC_BIN}" ]]; then
    echo "Azure Functions Core Tools not found at ${FUNC_BIN}" >&2
    echo "Install local dependencies with npm install before starting Functions." >&2
    exit 1
fi

export AzureWebJobsScriptRoot="${PROJECT_ROOT}"
export VIRTUAL_ENV="${PROJECT_ROOT}/.venv"
export PATH="${VIRTUAL_ENV}/bin:${PATH}"
export languageWorkers__python__defaultExecutablePath="${VENV_PYTHON}"

exec "${FUNC_BIN}" start --port "${DEFAULT_PORT}" "$@"