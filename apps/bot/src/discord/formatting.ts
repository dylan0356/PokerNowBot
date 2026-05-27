export function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

export function buildProfitGraphUrl(labels: string[], data: number[]) {
  for (const maxPoints of [120, 80, 50, 30]) {
    const sampled = downsampleSeries(labels, data, maxPoints);
    const url = buildQuickChartUrl(sampled.labels, sampled.data);
    if (url.length <= 1900) {
      return url;
    }
  }

  const sampled = downsampleSeries(labels, data, 20);
  return buildQuickChartUrl(sampled.labels, sampled.data);
}

function buildQuickChartUrl(labels: string[], data: number[]) {
  const chart = {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Profit",
          data,
          borderColor: "#0f766e",
          fill: false,
          pointRadius: 0,
        },
      ],
    },
    options: {
      legend: {
        display: false,
      },
    },
  };

  return `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chart))}`;
}

function downsampleSeries(labels: string[], data: number[], maxPoints: number) {
  if (data.length <= maxPoints) {
    return { labels, data };
  }

  const sampledLabels: string[] = [];
  const sampledData: number[] = [];
  const lastIndex = data.length - 1;

  for (let index = 0; index < maxPoints; index += 1) {
    const sourceIndex = Math.round((index / (maxPoints - 1)) * lastIndex);
    sampledLabels.push(labels[sourceIndex] ?? String(sourceIndex + 1));
    sampledData.push(data[sourceIndex] ?? 0);
  }

  return { labels: sampledLabels, data: sampledData };
}
