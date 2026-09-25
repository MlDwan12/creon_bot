import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { isDbId } from '../common/validation';

/** id из URL: как ParseIntPipe, но только то, что может быть id в базе. */
@Injectable()
export class ParseIdPipe implements PipeTransform<string, number> {
  transform(value: string): number {
    const id = /^\d+$/.test(value) ? Number(value) : NaN;
    if (!isDbId(id)) throw new BadRequestException('Некорректный id');
    return id;
  }
}
