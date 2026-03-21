export type FileCommand = 'new-tab' | 'new-window' | 'open' | 'save' | 'save-as';

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
