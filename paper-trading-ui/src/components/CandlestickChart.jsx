import { useEffect, useRef, useState, memo } from "react";
import { createChart, CandlestickSeries } from "lightweight-charts";
import { Maximize, Minimize } from "lucide-react";

// Thin renderer over lightweight-charts. All OHLC/tick math lives upstream in
// lib/candles; this component only draws.
function CandlestickChart({ candles, seriesKey }) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef(null);
  const chartWrapperRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const prevKeyRef = useRef(null);

  useEffect(() => {
    const chart = createChart(chartWrapperRef.current, {
      width: chartWrapperRef.current.clientWidth,
      height: chartWrapperRef.current.clientHeight || 460,
      layout: { background: { color: "transparent" }, textColor: "#A1A1AA" },
      grid: {
        vertLines: { color: "rgba(255, 255, 255, 0.05)" },
        horzLines: { color: "rgba(255, 255, 255, 0.05)" },
      },
      rightPriceScale: { borderColor: "rgba(255, 255, 255, 0.1)" },
      crosshair: {
        vertLine: { color: "#f7ca24", labelBackgroundColor: "#f7ca24" },
        horzLine: { color: "#f7ca24", labelBackgroundColor: "#f7ca24" },
      },
      timeScale: { borderColor: "rgba(255, 255, 255, 0.1)", timeVisible: true, secondsVisible: true },
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

    const resizeObserver = new ResizeObserver((entries) => {
      if (entries.length === 0 || entries[0].target !== chartWrapperRef.current) return;
      const newRect = entries[0].contentRect;
      chart.applyOptions({ width: newRect.width, height: newRect.height });
    });

    resizeObserver.observe(chartWrapperRef.current);

    return () => {
      resizeObserver.disconnect();
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

  const symbol = seriesKey ? seriesKey.split(':')[0] : 'Asset';
  return (
    <div 
      ref={containerRef} 
      className={`relative w-full ${isFullscreen ? "fixed inset-0 z-50 bg-surface flex flex-col p-4 md:p-8" : "h-[460px]"}`} 
      role="region"
      aria-label={`Interactive candlestick chart for ${symbol}`}
    >
      <div className="absolute right-4 top-4 z-10">
        <button
          onClick={() => setIsFullscreen(!isFullscreen)}
          className="rounded-md border border-line bg-surface/80 p-2 text-muted backdrop-blur transition-colors hover:bg-surface hover:text-ink shadow-sm"
          aria-label={isFullscreen ? "Exit full screen" : "Enter full screen"}
        >
          {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
        </button>
      </div>
      <div ref={chartWrapperRef} className={`w-full ${isFullscreen ? "flex-1" : "h-full"}`} />
    </div>
  );
}

export default memo(CandlestickChart);
