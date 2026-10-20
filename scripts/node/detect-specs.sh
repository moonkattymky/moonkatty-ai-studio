#!/bin/bash
# MOONKATTY NODE — read-only hardware/software report. bash 3.2 compatible (macOS default). Changes NOTHING.
# Usage: bash detect-specs.sh > ~/Desktop/moonkatty-specs.txt   (send that file back; it contains no secrets)
echo "== MOONKATTY detect-specs v1 ($(date '+%Y-%m-%d %H:%M %Z'))"
echo "hostname: $(scutil --get ComputerName 2>/dev/null || hostname)"
echo "model: $(sysctl -n hw.model 2>/dev/null)"
sp=$(system_profiler SPHardwareDataType 2>/dev/null)
echo "$sp" | grep -E "Model Name|Model Identifier|Processor Name|Processor Speed|Number of Processors|Total Number of Cores|Chip|Memory:" | sed 's/^ *//'
echo "macos: $(sw_vers -productName 2>/dev/null) $(sw_vers -productVersion 2>/dev/null) ($(sw_vers -buildVersion 2>/dev/null))"
echo "arch: $(uname -m)  kernel: $(uname -r)"
echo "cpu: $(sysctl -n machdep.cpu.brand_string 2>/dev/null)  cores: $(sysctl -n hw.physicalcpu 2>/dev/null) threads: $(sysctl -n hw.logicalcpu 2>/dev/null)"
mem=$(sysctl -n hw.memsize 2>/dev/null); [ -n "$mem" ] && echo "ram_gb: $((mem / 1073741824))"
echo "-- memory (vm_stat, pages):"; vm_stat 2>/dev/null | grep -E "page size|Pages free|Pages active|Pages inactive|Pages wired|occupied by compressor"
echo "swap: $(sysctl -n vm.swapusage 2>/dev/null)"
echo "-- disk:"; df -h / 2>/dev/null | tail -1
diskutil info / 2>/dev/null | grep -E "Solid State|File System Personality|Media Name" | sed 's/^ *//'
echo "-- tools:"
for t in node npm python3 ffprobe ffmpeg sips magick convert curl git brew tailscale openssl; do
  p=$(command -v "$t" 2>/dev/null)
  if [ -n "$p" ]; then v=""; case "$t" in node) v=$("$p" -v 2>/dev/null);; python3) v=$("$p" --version 2>&1);; ffprobe|ffmpeg) v=$("$p" -version 2>/dev/null | head -1);; magick|convert) v=$("$p" -version 2>/dev/null | head -1);; git) v=$("$p" --version 2>/dev/null);; tailscale) v=$("$p" version 2>/dev/null | head -1);; openssl) v=$("$p" version 2>/dev/null);; curl) v=$("$p" --version 2>/dev/null | head -1);; esac
    echo "  $t: $p $v"; else echo "  $t: нет"; fi
done
[ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ] && echo "  Tailscale.app: есть"
echo "-- network (LAN addresses only):"; ifconfig 2>/dev/null | awk '/inet /{print "  "$2}' | grep -E "^  (10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|100\.)" 
echo "-- firewall: $(/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate 2>/dev/null)"
echo "-- battery/power: $(pmset -g batt 2>/dev/null | tail -1 | sed 's/^ *//')"
v=$(sw_vers -productVersion 2>/dev/null); maj=${v%%.*}; rest=${v#*.}; min=${rest%%.*}; [ "$maj" = "10" ] && maj="10.$min"
case "$maj" in
  1[3-9]|2[0-9]) echo "verdict: macOS $v → Node.js 24 LTS или 22 LTS (рекомендуется встроенный в пакет Node 22 x64)";;
  11|12) echo "verdict: macOS $v → Node.js 22 LTS x64 (официально поддерживается macOS ≥ 11). Пакет MOONKATTY NODE содержит его.";;
  10.15) echo "verdict: macOS 10.15 → Node 22 официально НЕ поддерживается; запасной вариант — Node 18 (EOL) или обновление macOS до 12 (MacBook 2015 поддерживает Monterey)";;
  *) echo "verdict: macOS $v слишком старая → обновите до macOS 12 Monterey (поддерживается MacBook Pro/Air 2015) через App Store";;
esac
