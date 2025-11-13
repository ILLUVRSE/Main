"use client";

import Link from "next/link";
import Cookies from "js-cookie";
import { useRouter } from "next/navigation";

export default function Nav(): JSX.Element {
  const router = useRouter();

  function logout() {
    Cookies.remove("controlpanel_token");
    Cookies.remove("controlpanel_role");
    router.push("/login");
  }

  return (
    <nav className="bg-white border-b">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          <div className="flex items-center space-x-6">
            {/* Use Link directly (do NOT wrap an <a> inside Link when using App Router) */}
            <Link href="/" className="text-lg font-bold text-gray-800">
              ControlPanel
            </Link>

            <Link
              href="/agents"
              className="text-sm text-gray-600 hover:text-gray-800"
            >
              Agents
            </Link>

            <Link
              href="/audit"
              className="text-sm text-gray-600 hover:text-gray-800"
            >
              Audit
            </Link>

            <Link
              href="/policies"
              className="text-sm text-gray-600 hover:text-gray-800"
            >
              Policies
            </Link>

            <Link
              href="/control-panel"
              className="text-sm text-gray-600 hover:text-gray-800"
            >
              Admin
            </Link>
          </div>

          <div>
            <button
              onClick={logout}
              className="text-sm text-red-600 hover:text-red-800 bg-white border border-transparent px-3 py-1 rounded"
            >
              Logout
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
