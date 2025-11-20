export type MetricIntent = "neutral" | "warning" | "info" | "danger";

interface MetricCardProps {
  label: string;
  value: number;
  helper: string;
  intent?: MetricIntent;
}

export function MetricCard({ label, value, helper, intent = "neutral" }: MetricCardProps) {
  const styles: Record<MetricIntent, string> = {
    neutral: "border-gray-200",
    warning: "border-yellow-200 bg-yellow-50",
    info: "border-blue-200 bg-blue-50",
    danger: "border-rose-200 bg-rose-50",
  } as const;
  return (
    <div className={`rounded-2xl border px-4 py-3 ${styles[intent]}`}>
      <div className="text-xs uppercase tracking-[0.2em] text-gray-500">{label}</div>
      <div className="mt-1 text-3xl font-semibold text-gray-900" data-testid="metric-value">
        {value}
      </div>
      <div className="text-xs text-gray-500">{helper}</div>
    </div>
  );
}
