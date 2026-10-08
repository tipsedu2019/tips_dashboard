import { handleChatOutbox } from '@/features/chat/server/chat-production';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const GET=handleChatOutbox;
