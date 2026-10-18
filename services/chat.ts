import { api, getServerUrl } from "./api";

export interface ChatMessage {
  id: string;
  sender: "USER" | "BOT" | "ADMIN";
  text: string | null;
  imageUrl: string | null;
  createdAt: string;
  /** Support withdrew it. Arrives with no content — the client drops it. */
  deleted?: boolean;
  /** What polling asks from. Changes on an edit, where createdAt does not. */
  updatedAt?: string;
}

export interface QuickOption {
  label: string;
  value: string;
}

export interface ChatConversation {
  id: string;
  status: "OPEN" | "RESOLVED";
  needsHuman: boolean;
  lastMessage: string;
  lastMessageAt: string;
  createdAt: string;
}

export async function listConversations(): Promise<ChatConversation[]> {
  const res = await api.get("/chat/conversations");
  return res.data.conversations;
}

export async function createConversation(): Promise<{
  conversation: { id: string; status: string; needsHuman: boolean; messages: ChatMessage[]; quickOptions: QuickOption[] };
}> {
  const res = await api.post("/chat/conversations");
  return res.data;
}

export async function getConversation(id: string): Promise<{
  conversation: { id: string; status: string; needsHuman: boolean; messages: ChatMessage[]; quickOptions: QuickOption[] };
}> {
  const res = await api.get(`/chat/conversations/${id}`);
  return res.data;
}

export async function sendMessage(
  convoId: string,
  body: { text?: string; quickOption?: string }
): Promise<{ messages: ChatMessage[]; needsHuman: boolean; quickOptions: QuickOption[] }> {
  const res = await api.post(`/chat/conversations/${convoId}/messages`, body);
  return res.data;
}

export async function sendChatImage(convoId: string, imageUri: string, text?: string): Promise<{ message: ChatMessage }> {
  const formData = new FormData();
  const filename = imageUri.split("/").pop() || "photo.jpg";
  const ext = filename.split(".").pop()?.toLowerCase() || "jpg";
  const mimeType = ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : "image/jpeg";

  formData.append("image", { uri: imageUri, name: filename, type: mimeType } as any);
  if (text) formData.append("text", text);

  const res = await api.post(`/chat/conversations/${convoId}/image`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
}

export async function pollMessages(
  convoId: string,
  since: string
): Promise<{ messages: ChatMessage[]; status: string; needsHuman: boolean }> {
  const res = await api.get(`/chat/conversations/${convoId}/poll`, { params: { since } });
  return res.data;
}

export async function resolveConversation(convoId: string): Promise<void> {
  await api.post(`/chat/conversations/${convoId}/resolve`);
}

export function getChatImageUrl(imageUrl: string): string {
  if (imageUrl.startsWith("http")) return imageUrl;
  return `${getServerUrl()}${imageUrl}`;
}
