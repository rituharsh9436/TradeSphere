import { useEffect, useRef } from "react";
import { createChart, CandlestickSeries } from "lightweight-charts";

// Thin renderer over lightweight-charts. All OHLC/tick math lives upstream in
// lib/candles; this component only draws.
function CandlestickChart({ candles, seriesKey }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const prevKeyRef = useRef(null);

  useEffect(() => {
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 460,
      layout: { background: { color: "#191b20" }, textColor: "#818690" },
      grid: {
        vertLines: { color: "#2a2d34" },
        horzLines: { color: "#2a2d34" },
      },
      rightPriceScale: { borderColor: "#383b44" },
      crosshair: {
        vertLine: { color: "#f7ca24", labelBackgroundColor: "#f7ca24" },
        horzLine: { color: "#f7ca24", labelBackgroundColor: "#f7ca24" },
      },
      timeScale: { borderColor: "#383b44", timeVisible: true, secondsVisible: true },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#21c983",
      downColor: "#ff5b6b",
      wickUpColor: "#21c983",
      wickDownColor: "#ff5b6b",
      borderVisible: false,
    });
    chartRef.current = chart;
    seriesRef.current = series;
    prevKeyRef.current = null;

    const onResize = () => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    if (seriesKey !== prevKeyRef.current) {
      series.setData(candles);
      prevKeyRef.current = seriesKey;
    } else if (candles.length > 0) {
      series.update(candles[candles.length - 1]);
    }
  }, [candles, seriesKey]);

  return <div ref={containerRef} className="h-[460px] w-full" />;
}

export default CandlestickChart;
