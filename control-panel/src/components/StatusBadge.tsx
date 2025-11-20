export function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800",
    active: "bg-blue-100 text-blue-800",
    applied: "bg-green-100 text-green-800",
    failed: "bg-red-100 text-red-800",
    rejected: "bg-gray-200 text-gray-700",
  };
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors[status] || "bg-gray-100 text-gray-600"}`}>
      {status}
    </span>
  );
}
