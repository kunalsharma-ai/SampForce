import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, type RawBodyRequest } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { sampbidxOpenChatSchema } from '@dealflow/types';
import type { z } from 'zod';
import { AlsoRequireFeature, Auth, type AuthContext, Public, RequireFeature } from '../common/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { SampbidxChatService } from './sampbidx-chat.service';

const uuid = new ParseUUIDPipe({ version: '4' });

/**
 * Chat with the SampBidx team inside Team chat (ADR 0077). Reading and writing the conversations goes through the
 * Team chat routes; these start a chat about an RFQ sent to SampBidx and resend a message SampBidx does not have.
 */
@Controller('apps/sampbidx/chat')
@RequireFeature('sampbidx_chat')
@AlsoRequireFeature('sampbidx', 'team_chat')
export class SampbidxChatController {
  constructor(private readonly chat: SampbidxChatService) {}

  @Get('transfers')
  transfers(@Auth() auth: AuthContext, @Query('q') q?: string) {
    return this.chat.transferOptions(auth, String(q ?? '').slice(0, 100));
  }

  @Post('open')
  @HttpCode(200)
  open(@Auth() auth: AuthContext, @Body(new ZodPipe(sampbidxOpenChatSchema)) body: z.infer<typeof sampbidxOpenChatSchema>) {
    return this.chat.openTransferChat(auth, body.transferId);
  }

  @Post('messages/:id/retry')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  retry(@Auth() auth: AuthContext, @Param('id', uuid) id: string) {
    return this.chat.retry(auth, id);
  }
}

/** SampBidx's side of the chat: its team's messages, and the SampForce people it may show. Both signed. */
@Controller('apps/sampbidx/callbacks/:hookId')
export class SampbidxChatCallbackController {
  constructor(private readonly chat: SampbidxChatService) {}

  @Post('messages')
  @Public()
  @SkipThrottle()
  @HttpCode(200)
  message(@Param('hookId') hookId: string, @Req() req: RawBodyRequest<Request>, @Headers('x-sampbidx-timestamp') ts?: string, @Headers('x-sampbidx-signature') sig?: string) {
    return this.chat.receive(hookId, req.rawBody, ts, sig);
  }

  @Get('people')
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  people(@Param('hookId') hookId: string, @Headers('x-sampbidx-timestamp') ts?: string, @Headers('x-sampbidx-signature') sig?: string) {
    return this.chat.people(hookId, ts, sig);
  }
}
