export type DashboardRuntimeMode = 'development' | 'production';

export function getDashboardRuntimeMode(nodeEnv: string | undefined): DashboardRuntimeMode {
  return nodeEnv === 'development' ? 'development' : 'production';
}