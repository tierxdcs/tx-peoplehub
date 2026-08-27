import { Module } from '@nestjs/common';
import { NavShortcutsController } from './nav-shortcuts.controller';
import { NavShortcutsService } from './nav-shortcuts.service';

/** Per-employee pinned sidebar shortcuts — a self-service UI preference store. */
@Module({
  controllers: [NavShortcutsController],
  providers: [NavShortcutsService],
})
export class NavShortcutsModule {}
