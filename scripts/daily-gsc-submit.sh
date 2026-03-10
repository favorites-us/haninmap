#!/bin/bash
#
# daily-gsc-submit.sh
# launchd로 매일 실행: GSC Indexing API에 URL 제출
# 진행 상황을 .gsc-offset 파일로 추적
# 다른 서비스와 quota 공유 — 실제 성공 수만큼만 오프셋 전진
#

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

PROJECT_DIR="/Users/hbrandon/Dev Projects/haninmap"
OFFSET_FILE="$PROJECT_DIR/.gsc-offset"
LOG_DIR="$PROJECT_DIR/logs"
BATCH_SIZE=200

# 로그 디렉토리 생성
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/gsc-submit-$(date +%Y%m%d).log"

# URL 파일 순서: L1 → L2 → L3
FILES=("urls-l1.txt" "urls-l2.txt" "urls-l3.txt")

# 오프셋 읽기 (파일인덱스:라인오프셋)
if [ -f "$OFFSET_FILE" ]; then
  FILE_IDX=$(cut -d: -f1 "$OFFSET_FILE")
  LINE_OFFSET=$(cut -d: -f2 "$OFFSET_FILE")
else
  FILE_IDX=0
  LINE_OFFSET=0
fi

echo "=== $(date) ===" >> "$LOG_FILE"
echo "Starting: file=${FILES[$FILE_IDX]}, offset=$LINE_OFFSET" >> "$LOG_FILE"

# 현재 파일이 모든 파일을 초과하면 완료
if [ "$FILE_IDX" -ge "${#FILES[@]}" ]; then
  echo "All files submitted. Done." >> "$LOG_FILE"
  exit 0
fi

CURRENT_FILE="$PROJECT_DIR/${FILES[$FILE_IDX]}"

# 파일 존재 확인
if [ ! -f "$CURRENT_FILE" ]; then
  echo "File not found: $CURRENT_FILE" >> "$LOG_FILE"
  exit 1
fi

TOTAL_LINES=$(wc -l < "$CURRENT_FILE" | tr -d ' ')

# 현재 파일 끝에 도달했으면 다음 파일로
if [ "$LINE_OFFSET" -ge "$TOTAL_LINES" ]; then
  FILE_IDX=$((FILE_IDX + 1))
  LINE_OFFSET=0
  echo "$FILE_IDX:$LINE_OFFSET" > "$OFFSET_FILE"
  echo "Moving to next file (index=$FILE_IDX)" >> "$LOG_FILE"

  if [ "$FILE_IDX" -ge "${#FILES[@]}" ]; then
    echo "All files submitted. Done." >> "$LOG_FILE"
    exit 0
  fi

  CURRENT_FILE="$PROJECT_DIR/${FILES[$FILE_IDX]}"
  TOTAL_LINES=$(wc -l < "$CURRENT_FILE" | tr -d ' ')
fi

# 남은 URL에서 배치 추출
REMAINING=$((TOTAL_LINES - LINE_OFFSET))
SUBMIT_COUNT=$((REMAINING < BATCH_SIZE ? REMAINING : BATCH_SIZE))

BATCH_FILE="$PROJECT_DIR/.gsc-batch-tmp.txt"
tail -n +"$((LINE_OFFSET + 1))" "$CURRENT_FILE" | head -n "$SUBMIT_COUNT" > "$BATCH_FILE"

echo "Submitting up to $SUBMIT_COUNT URLs from ${FILES[$FILE_IDX]} (offset $LINE_OFFSET)" >> "$LOG_FILE"

# 제출 실행 — 출력을 캡처하여 실제 성공 수 파싱
cd "$PROJECT_DIR"
OUTPUT=$(node --env-file=.env node_modules/.bin/tsx scripts/submit-to-gsc.ts "$BATCH_FILE" --limit="$BATCH_SIZE" 2>&1) || true

echo "$OUTPUT" >> "$LOG_FILE"

# 실제 성공 수 파싱 (출력에서 "Success: N" 추출)
ACTUAL_SUCCESS=$(echo "$OUTPUT" | grep -oE 'Success: [0-9]+' | grep -oE '[0-9]+')

if [ -z "$ACTUAL_SUCCESS" ]; then
  ACTUAL_SUCCESS=0
fi

# 성공한 만큼만 오프셋 전진
if [ "$ACTUAL_SUCCESS" -gt 0 ]; then
  NEW_OFFSET=$((LINE_OFFSET + ACTUAL_SUCCESS))
  echo "$FILE_IDX:$NEW_OFFSET" > "$OFFSET_FILE"
  echo "Updated offset: $FILE_IDX:$NEW_OFFSET (submitted $ACTUAL_SUCCESS)" >> "$LOG_FILE"
else
  echo "No URLs submitted (quota may be exhausted). Offset unchanged: $FILE_IDX:$LINE_OFFSET" >> "$LOG_FILE"
fi

echo "=== Done ===" >> "$LOG_FILE"

# 임시 파일 삭제
rm -f "$BATCH_FILE"
