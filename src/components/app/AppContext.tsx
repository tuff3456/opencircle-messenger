import { createContext, useContext } from "react";
export type AppCtx = {
  openProfile: (userId: string) => void;
  openConversation: (id: string) => void;
  dmUser: (userId: string, call?: boolean) => Promise<void>;
  joinCall: (conversationId: string) => void;
};
export const AppContext = createContext<AppCtx>({
  openProfile: () => {}, openConversation: () => {}, dmUser: async () => {}, joinCall: () => {},
});
export const useApp = () => useContext(AppContext);
