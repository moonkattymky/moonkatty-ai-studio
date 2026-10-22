#!/bin/bash
# Read-only diagnostics for MOONKATTY AI STUDIO. Prints a text report and exits.
# Does not change settings, does not read the keychain, does not stop processes.
# MK_DIAG_OUT and MK_DIAG_PATH_PREFIX exist so the automated test can stub commands.
set +e
umask 077

SYS_PATH="/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin"
if [ -n "${MK_DIAG_PATH_PREFIX:-}" ]; then
  PATH="${MK_DIAG_PATH_PREFIX}:${SYS_PATH}"
else
  PATH="${SYS_PATH}:${PATH:-}"
fi
export PATH

STAMP=$(date +%Y%m%d-%H%M%S)
if [ -n "${MK_DIAG_OUT:-}" ]; then
  OUT="$MK_DIAG_OUT"
else
  if [ -d "${HOME}/Desktop" ]; then
    OUT="${HOME}/Desktop/MOONKATTY-diagnose-${STAMP}.txt"
  else
    OUT="${HOME}/MOONKATTY-diagnose-${STAMP}.txt"
  fi
fi
mkdir -p "$(dirname "$OUT")"

http_code() {
  local url="$1" code
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 2 --max-redirs 0 "$url" 2>/dev/null) || true
  if [ -z "$code" ]; then code=000; fi
  printf '%s' "$code"
}

{
  echo "MOONKATTY AI STUDIO diagnose (read-only)"
  echo "when: $(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date)"
  echo "host: $(hostname 2>/dev/null)"
  echo "uname: $(uname -srm 2>/dev/null)"
  echo
  echo "== RAM (vm_stat) =="
  if command -v vm_stat >/dev/null 2>&1; then
    vm_stat
  else
    echo "vm_stat: отсутствует"
  fi
  echo
  echo "== memory_pressure =="
  if command -v memory_pressure >/dev/null 2>&1; then
    memory_pressure
  else
    echo "memory_pressure: отсутствует"
  fi
  echo
  echo "== CPU load =="
  uptime 2>/dev/null || echo "uptime: отсутствует"
  echo
  echo "== processes (pid rss %cpu comm; аргументы командной строки не печатаются) =="
  if ps -axo pid=,rss=,%cpu=,comm= >/dev/null 2>&1; then
    ps -axo pid=,rss=,%cpu=,comm= 2>/dev/null | grep -i -E 'ollama|opencode|blender|moonkatty|electron' || true
  else
    echo "ps: отсутствует"
  fi
  echo
  echo "== disk =="
  df -h / 2>/dev/null || echo "df: отсутствует"
  echo
  echo "== ports (listen + HTTP status only, no credentials) =="
  for port in 8787 8687 4096 4097; do
    echo "-- ${port} --"
    if command -v lsof >/dev/null 2>&1; then
      lsof -nP -iTCP:"${port}" -sTCP:LISTEN 2>/dev/null || echo "не слушает"
    else
      echo "lsof: отсутствует"
    fi
    if command -v curl >/dev/null 2>&1; then
      echo "http ${port}/api/health -> $(http_code "http://127.0.0.1:${port}/api/health")"
    else
      echo "curl: отсутствует"
    fi
  done
  echo
  echo "== 4097 without auth =="
  if command -v curl >/dev/null 2>&1; then
    for path in /global/health /session; do
      code=$(http_code "http://127.0.0.1:4097${path}")
      echo "http 4097${path} no Authorization -> ${code}"
      case "$code" in
        401|403) echo "reject: да (${code})" ;;
        000) echo "reject: нет соединения" ;;
        *) echo "reject: нет (код ${code})" ;;
      esac
    done
  else
    echo "curl: отсутствует"
  fi
  echo
  echo "== tailscale =="
  if command -v tailscale >/dev/null 2>&1; then
    raw=$(tailscale status --json 2>/dev/null)
    state=$(printf '%s' "$raw" | tr -d '\n' | sed -n 's/.*"BackendState"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
    if [ -n "$state" ]; then
      echo "CLI: есть"
      echo "BackendState: ${state}"
      if [ "$state" = "Running" ]; then echo "status: up"; else echo "status: не up"; fi
    else
      echo "CLI: есть"
      echo "BackendState: не прочитан"
    fi
  else
    echo "CLI: отсутствует"
  fi
  echo
  echo "== test data =="
  TD="${HOME}/Library/Application Support/MOONKATTY AI STUDIO TEST"
  if [ -d "$TD" ]; then
    echo "data dir: существует"
    if [ -d "${TD}/backups" ]; then
      n=$(find "${TD}/backups" -type f 2>/dev/null | wc -l | tr -d ' ')
      echo "backups: каталог есть, файлов ${n}"
    else
      echo "backups: каталога нет"
    fi
  else
    echo "data dir: отсутствует"
  fi
  echo
  echo "done. Ничего не остановлено и не изменено, кроме этого отчёта."
} > "$OUT"

echo "report: $OUT"
