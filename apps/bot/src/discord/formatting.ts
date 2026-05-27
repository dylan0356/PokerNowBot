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
          borderColor: "#1f8b4c",
          backgroundColor: "rgba(31,139,76,0.12)",
          borderWidth: 3,
          fill: false,
          pointRadius: 0,
          pointHitRadius: 8,
          tension: 0.25,
        },
      ],
    },
    options: {
      title: {
        display: true,
        text: "Cumulative Profit By Hand",
        fontSize: 18,
        fontColor: "#111827",
      },
      legend: {
        display: false,
      },
      layout: {
        padding: {
          left: 8,
          right: 16,
          top: 8,
          bottom: 8,
        },
      },
      scales: {
        xAxes: [
          {
            scaleLabel: {
              display: true,
              labelString: "Hands Played",
              fontColor: "#374151",
            },
            gridLines: {
              color: "rgba(156,163,175,0.2)",
            },
            ticks: {
              fontColor: "#4b5563",
              maxTicksLimit: 10,
            },
          },
        ],
        yAxes: [
          {
            scaleLabel: {
              display: true,
              labelString: "Profit",
              fontColor: "#374151",
            },
            gridLines: {
              color: "rgba(156,163,175,0.25)",
            },
            ticks: {
              fontColor: "#4b5563",
            },
          },
        ],
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
