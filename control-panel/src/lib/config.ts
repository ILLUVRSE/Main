export type AppConfig = {
  kernelApiUrl: string;
  kernelToken?: string;
  reasoningGraphUrl?: string;
  sentinelUrl?: string;
  signingProxyUrl?: string;
  demoMode: boolean;
};

const config: AppConfig = {
  kernelApiUrl: process.env.KERNEL_API_URL || process.env.NEXT_PUBLIC_KERNEL_URL || '',
  kernelToken: process.env.KERNEL_CONTROL_PANEL_TOKEN,
  reasoningGraphUrl: process.env.REASONING_GRAPH_URL,
  sentinelUrl: process.env.SENTINEL_URL,
  signingProxyUrl: process.env.SIGNING_PROXY_URL || process.env.NEXT_PUBLIC_SIGNING_PROXY_URL,
  demoMode: !process.env.KERNEL_API_URL && !process.env.NEXT_PUBLIC_KERNEL_URL,
};

export default config;
