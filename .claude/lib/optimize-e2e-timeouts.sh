#!/bin/bash
# Script to optimize E2E test timeouts

echo "🚀 Optimizing E2E test timeouts..."

# Replace waitForTimeout with proper wait strategies
find e2e -name "*.spec.ts" -type f | while read file; do
  # Backup original
  cp "$file" "$file.bak"
  
  # Replace common patterns
  sed -i '' 's/await page\.waitForTimeout(100)/await page.waitForLoadState("domcontentloaded")/g' "$file"
  sed -i '' 's/await page\.waitForTimeout(200)/await page.waitForLoadState("domcontentloaded")/g' "$file"
  sed -i '' 's/await page\.waitForTimeout(500)/await page.waitForLoadState("domcontentloaded")/g' "$file"
  sed -i '' 's/await page\.waitForTimeout(1000)/await page.waitForLoadState("networkidle")/g' "$file"
  sed -i '' 's/await page\.waitForTimeout(2000)/await page.waitForLoadState("networkidle")/g' "$file"
  
  # Check if file changed
  if ! diff -q "$file" "$file.bak" > /dev/null; then
    echo "✅ Optimized: $file"
    rm "$file.bak"
  else
    rm "$file.bak"
  fi
done

echo "✨ Optimization complete!"