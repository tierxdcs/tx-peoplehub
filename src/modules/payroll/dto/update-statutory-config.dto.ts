import { CreateStatutoryConfigDto } from './create-statutory-config.dto';

/** Full replacement of one effective-dated version. Keeping the same shape as
 * create makes validation and compliance review consistent. The service keeps
 * configType immutable so an edit cannot silently turn one rule into another. */
export class UpdateStatutoryConfigDto extends CreateStatutoryConfigDto {}
