#!/bin/bash
# Optimized E2E test runner with configurable workers

echo "🚀 Running optimized E2E tests..."
echo "CPU cores available: $(sysctl -n hw.ncpu)"

# Test with different worker counts
if [ "$1" == "benchmark" ]; then
  echo -e "\n📊 Benchmarking different worker counts..."
  
  for workers in 1 2 4 8; do
    echo -e "\n🔧 Testing with $workers worker(s)..."
    start_time=$(date +%s)
    PLAYWRIGHT_WORKERS=$workers pnpm test:e2e e2e/dashboard/bots/bot-list.spec.ts --grep "displays bot cards" 2>&1 | tail -3
    end_time=$(date +%s)
    duration=$((end_time - start_time))
    echo "⏱️  Duration with $workers workers: ${duration}s"
  done
else
  # Run with optimal settings
  workers=${1:-4}
  echo "Running with $workers workers (pass number as argument to change)"
  PLAYWRIGHT_WORKERS=$workers pnpm test:e2e "${2:-e2e/dashboard/bots}"
fi