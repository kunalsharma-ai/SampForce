import { Module } from '@nestjs/common';
import { OperatorGuard, OperatorTokens } from '../operator/operator-auth';
import { ChatBus } from './chat-bus';
import { ChatController, OperatorChatController } from './chat.controller';
import { ChatService } from './chat.service';

/** Team chat and the support line to super admins (ADR 0064). */
@Module({ controllers: [ChatController, OperatorChatController], providers: [ChatService, ChatBus, OperatorTokens, OperatorGuard], exports: [ChatService] })
export class ChatModule {}
