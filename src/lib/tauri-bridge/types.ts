export type FileCommand = 'new-tab' | 'new-window' | 'open' | 'save' | 'save-as';

export type ViewCommand = 'fit-view' | 'reset-zoom' | 'zoom-in' | 'zoom-out';

export type McpLifecycleStatus = 'started' | 'stopped';

export type SaveProjectStatus = 'saved' | 'cancelled' | 'error';

export type WindowContext = {
  filePath: string | null;
  untitledIndex: number;
};

export type NavigationState = {
  can_go_back: boolean;
  can_go_forward: boolean;
};

export type PlatformInfo = {
  platform: string;
  trafficLightWidth: number;
};

export type AppExitStateRequest = {
  coordinatorLabel: string;
  requestId: string;
};

export type AppExitStateSnapshot = {
  windowLabel: string;
  projectTitle: string;
  dirty: boolean;
};

export type AppExitStateResponse = AppExitStateSnapshot & {
  requestId: string;
};

export type AppExitSaveRequest = {
  coordinatorLabel: string;
  requestId: string;
};

export type AppExitSaveResponse = {
  requestId: string;
  windowLabel: string;
  status: SaveProjectStatus;
};

export type {
  RendererRequest as McpRendererRequest,
  RendererResponse as McpRendererResponse,
} from '@/lib/mcp/types';
