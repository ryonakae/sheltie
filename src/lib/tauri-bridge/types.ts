export type FileCommand = 'open' | 'save' | 'save-as';

export type NavigationState = {
  can_go_back: boolean;
  can_go_forward: boolean;
};

export type PlatformInfo = {
  platform: string;
  trafficLightWidth: number;
};
