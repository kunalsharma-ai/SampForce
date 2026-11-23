import { Module } from '@nestjs/common';
import { MobileModule } from '../mobile/mobile.module';
import { OperatorGuard, OperatorTokens } from '../operator/operator-auth';
import { ChatBus } from './chat-bus';
import { ChatPresence } from './chat-presence';
import { ChatSocketServer, ChatSocketTickets } from './chat-socket';
import { ChatController, OperatorChatController } from './chat.controller';
import { ChatService } from './chat.service';

/** Team chat and the support line to super admins (ADR 0064), live over WebSocket with a catch-up fallback (ADR 0069). */
@Module({
  imports: [MobileModule],
  controllers: [ChatController, OperatorChatController],
  providers: [ChatService, ChatBus, ChatPresence, ChatSocketTickets, ChatSocketServer, OperatorTokens, OperatorGuard],
  exports: [ChatService, ChatBus],
})
export class ChatModule {}
