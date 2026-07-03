import { useEffect, useRef } from "react";
import { createChart, CandlestickSeries } from "lightweight-charts";

// Thin renderer over lightweight-charts. All OHLC/tick math lives upstream in
// lib/candles; this component only draws. `seriesKey` changing means "full
// reload" (setData); otherwise a changed `candles` array means "one new tick"
// (update the latest bar).
function CandlestickChart({ candles, seriesKey }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const prevKeyRef = useRef(null);

  // Create the chart once; clean up on unmount (and StrictMode remount).
  useEffect(() => {
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 460,
      layout: { background: { color: "#1a1a19" }, textColor: "#c3c2b7" },
      grid: {
        vertLines: { color: "#2c2c2a" },
        horzLines: { color: "#2c2c2a" },
      },
      rightPriceScale: { borderColor: "#2c2c2a" },
      timeScale: { borderColor: "#2c2c2a", timeVisible: true, secondsVisible: true },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "rgb(38, 166, 154)",
      downColor: "rgb(239, 83, 80)",
      wickUpColor: "rgb(38, 166, 154)",
      wickDownColor: "rgb(239, 83, 80)",
      borderVisible: false,
    });
    chartRef.current = chart;
    seriesRef.current = series;
    prevKeyRef.current = null; // force a setData on the first data effect

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

  // Push data: full reload when the key changes, else update the last bar.
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
