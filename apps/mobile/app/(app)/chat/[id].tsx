import { useLocalSearchParams } from 'expo-router';
import { Conversation } from '../../../src/components/chat';

export default function ChatConversation() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Conversation key={id} id={String(id)} />;
}
