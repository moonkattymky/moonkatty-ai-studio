#!/bin/sh
# Сливает текущий HEAD с веткой интеграции и печатает конфликтующие пути.
# По умолчанию integ/v1.3.0-test. Studio назвала эту ветку, база будет 322023f.
# Ветки ещё нет: скрипт печатает BLOCKED и выходит с кодом 2. Саму ветку не создаёт.
set -eu
REF="${1:-integ/v1.3.0-test}"
TARGET=""
if git rev-parse --verify --quiet "${REF}^{commit}" >/dev/null; then
  TARGET="$REF"
elif git rev-parse --verify --quiet "origin/${REF}^{commit}" >/dev/null; then
  TARGET="origin/${REF}"
fi
if [ -z "$TARGET" ]; then
  echo "BLOCKED: ветка ${REF} не найдена"
  exit 2
fi
echo "merge-tree HEAD ${TARGET}"
git merge-tree --write-tree --name-only HEAD "$TARGET"
