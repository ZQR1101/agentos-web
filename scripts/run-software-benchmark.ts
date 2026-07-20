import { loadSoftwareBenchmarkDataset, runSoftwareBenchmark, writeSoftwareBenchmarkReport } from "../src/lib/software-agent-benchmark";

void (async () => {
  const report = runSoftwareBenchmark(await loadSoftwareBenchmarkDataset());
  const output = await writeSoftwareBenchmarkReport(report);
  console.log(JSON.stringify({ output, ...report.summary, breakdown: report.breakdown }, null, 2));
  if (report.summary.passed !== report.summary.total) process.exitCode = 1;
})().catch((error) => { console.error(error); process.exitCode = 1; });
