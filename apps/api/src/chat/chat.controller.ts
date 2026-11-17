import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  chatConversationInputSchema,
  chatConversationUpdateSchema,
  chatLinkQuerySchema,
  chatMembersInputSchema,
  chatMessageEditSchema,
  chatMessageInputSchema,
  chatMessagesQuerySchema,
  chatReadSchema,
  chatSearchQuerySchema,
  type z,
} from '@dealflow/types';
import { Auth, type AuthContext, Meta, Public, type RequestMeta, RequireFeature } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { Operator, type OperatorContext, OperatorGuard } from '../operator/operator-auth';
import { fileFrom, readUpload, sendFile } from '../portal/portal-documents';
import { ChatBus } from './chat-bus';
import { openChatStream } from './chat-stream';
import { type ChatActor, ChatService } from './chat.service';

const uuid = new ParseUUIDPipe();
const user = (auth: AuthContext): ChatActor => ({ kind: 'user', auth });

/**
 * Team chat for the people of a workspace (ADR 0064): direct messages, channels and the support line. Signed-in
 * sessions only (no API keys), behind the `team_chat` plan feature.
 */
@Controller('chat')
@RequireFeature('team_chat')
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly bus: ChatBus,
  ) {}

  /** Live events (Server-Sent Events). The browser re-reads what an event names. */
  @Get('stream')
  @SkipThrottle()
  stream(@Auth() auth: AuthContext, @Req() req: Request, @Res() res: Response): void {
    openChatStream(this.bus, req, res, { realm: 'user', tenantId: auth.tenantId, userId: auth.userId });
  }

  @Get('unread')
  unread(@Auth() auth: AuthContext) {
    return this.chat.unreadTotal(auth);
  }

  @Get('people')
  people(@Auth() auth: AuthContext) {
    return this.chat.directory(auth);
  }

  @Get('link-options')
  linkOptions(@Auth() auth: AuthContext, @Query(new ZodPipe(chatLinkQuerySchema)) q: z.output<typeof chatLinkQuerySchema>) {
    return this.chat.linkOptions(auth, q.q);
  }

  @Get('search')
  search(@Auth() auth: AuthContext, @Query(new ZodPipe(chatSearchQuerySchema)) q: z.output<typeof chatSearchQuerySchema>) {
    return this.chat.search(auth, q);
  }

  @Get('conversations')
  list(@Auth() auth: AuthContext, @Query('archived') archived: string | undefined) {
    return this.chat.list(auth, archived === 'true');
  }

  @Post('conversations')
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(chatConversationInputSchema)) body: z.output<typeof chatConversationInputSchema>, @Meta() meta: RequestMeta) {
    return this.chat.create(auth, body, meta);
  }

  @Get('conversations/:id')
  get(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.chat.get(user(auth), id);
  }

  @Patch('conversations/:id')
  update(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(chatConversationUpdateSchema)) body: z.output<typeof chatConversationUpdateSchema>, @Meta() meta: RequestMeta) {
    return this.chat.update(auth, id, body, meta);
  }

  @Post('conversations/:id/members')
  addMembers(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(chatMembersInputSchema)) body: z.output<typeof chatMembersInputSchema>, @Meta() meta: RequestMeta) {
    return this.chat.addMembers(auth, id, body.userIds, meta);
  }

  @Delete('conversations/:id/members/:userId')
  @HttpCode(204)
  removeMember(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Param('userId', uuid) userId: string, @Meta() meta: RequestMeta) {
    return this.chat.removeMember(auth, id, userId, meta);
  }

  @Get('conversations/:id/messages')
  messages(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Query(new ZodPipe(chatMessagesQuerySchema)) q: z.output<typeof chatMessagesQuerySchema>) {
    return this.chat.messages(user(auth), id, q);
  }

  @Post('conversations/:id/messages')
  send(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(chatMessageInputSchema)) body: z.output<typeof chatMessageInputSchema>) {
    return this.chat.send(user(auth), id, body);
  }

  @Post('conversations/:id/read')
  @HttpCode(200)
  read(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(chatReadSchema)) body: z.output<typeof chatReadSchema>) {
    return this.chat.markRead(user(auth), id, body.messageId);
  }

  /** Upload a file as the raw request body (up to 10 MB); send it by naming it in a message's attachmentIds. */
  @Post('conversations/:id/attachments')
  async upload(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Query('name') name: string | undefined, @Req() req: Request) {
    return this.chat.upload(user(auth), id, fileFrom(req, name, await readUpload(req)));
  }

  @Get('attachments/:id/download')
  async download(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Res() res: Response): Promise<void> {
    sendFile(res, await this.chat.download(user(auth), id));
  }

  @Patch('messages/:id')
  edit(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Body(new ZodPipe(chatMessageEditSchema)) body: z.output<typeof chatMessageEditSchema>) {
    return this.chat.edit(user(auth), id, body.body);
  }

  @Delete('messages/:id')
  @HttpCode(204)
  remove(@Auth() auth: AuthContext, @Param('id', uuid) id: string, @Meta() meta: RequestMeta) {
    return this.chat.remove(user(auth), id, meta);
  }
}

/**
 * The support lines seen from the operator console: every super admin (operator) reads and answers every
 * workspace's support line. `@Public()` only skips the workspace guard; OperatorGuard protects every route.
 */
@Controller('operator/chat')
@Public()
@UseGuards(OperatorGuard)
export class OperatorChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly bus: ChatBus,
  ) {}

  private op(op: OperatorContext): ChatActor {
    return { kind: 'operator', op };
  }

  @Get('stream')
  @SkipThrottle()
  stream(@Operator() op: OperatorContext, @Req() req: Request, @Res() res: Response): void {
    openChatStream(this.bus, req, res, { realm: 'operator', operatorId: op.id });
  }

  @Get('unread')
  unread(@Operator() op: OperatorContext) {
    return this.chat.operatorUnread(op);
  }

  @Get('conversations')
  list(@Operator() op: OperatorContext) {
    return this.chat.operatorList(op);
  }

  /** Opens a workspace's support line, creating it if nobody has written yet. */
  @Post('workspaces/:tenantId/support')
  @HttpCode(200)
  open(@Operator() op: OperatorContext, @Param('tenantId', uuid) tenantId: string) {
    return this.chat.operatorOpen(op, tenantId);
  }

  @Get('conversations/:id')
  async get(@Operator() op: OperatorContext, @Param('id', uuid) id: string) {
    return this.chat.get(this.op(op), id, await this.chat.tenantOfConversation(id));
  }

  @Get('conversations/:id/messages')
  async messages(@Operator() op: OperatorContext, @Param('id', uuid) id: string, @Query(new ZodPipe(chatMessagesQuerySchema)) q: z.output<typeof chatMessagesQuerySchema>) {
    return this.chat.messages(this.op(op), id, q, await this.chat.tenantOfConversation(id));
  }

  @Post('conversations/:id/messages')
  async send(@Operator() op: OperatorContext, @Param('id', uuid) id: string, @Body(new ZodPipe(chatMessageInputSchema)) body: z.output<typeof chatMessageInputSchema>) {
    return this.chat.send(this.op(op), id, body, await this.chat.tenantOfConversation(id));
  }

  @Post('conversations/:id/read')
  @HttpCode(200)
  async read(@Operator() op: OperatorContext, @Param('id', uuid) id: string, @Body(new ZodPipe(chatReadSchema)) body: z.output<typeof chatReadSchema>) {
    return this.chat.markRead(this.op(op), id, body.messageId, await this.chat.tenantOfConversation(id));
  }

  @Post('conversations/:id/attachments')
  async upload(@Operator() op: OperatorContext, @Param('id', uuid) id: string, @Query('name') name: string | undefined, @Req() req: Request) {
    const tenantId = await this.chat.tenantOfConversation(id);
    return this.chat.upload(this.op(op), id, fileFrom(req, name, await readUpload(req)), tenantId);
  }

  @Get('conversations/:id/attachments/:fileId/download')
  async download(@Operator() op: OperatorContext, @Param('id', uuid) id: string, @Param('fileId', uuid) fileId: string, @Res() res: Response): Promise<void> {
    sendFile(res, await this.chat.download(this.op(op), fileId, await this.chat.tenantOfConversation(id), id));
  }

  @Patch('messages/:id')
  async edit(@Operator() op: OperatorContext, @Param('id', uuid) id: string, @Body(new ZodPipe(chatMessageEditSchema)) body: z.output<typeof chatMessageEditSchema>) {
    return this.chat.edit(this.op(op), id, body.body, await this.chat.tenantOfMessage(id));
  }

  @Delete('messages/:id')
  @HttpCode(204)
  async remove(@Operator() op: OperatorContext, @Param('id', uuid) id: string) {
    return this.chat.remove(this.op(op), id, undefined, await this.chat.tenantOfMessage(id));
  }
}
