import { Controller, Get, UseGuards } from '@nestjs/common';
import { Public } from '../common/auth-context';
import { ConsoleSystemService } from './console-system.service';
import { OperatorAny, OperatorGuard } from './operator-auth';

/** The system status in the Console header (control-center K1): every signed-in operator sees it. */
@Controller('operator')
@Public()
@UseGuards(OperatorGuard)
export class ConsoleSystemController {
  constructor(private readonly system: ConsoleSystemService) {}

  @Get('system/status')
  @OperatorAny()
  status() {
    return this.system.status();
  }
}
