import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

/**
 * Address fields accept either a JSON object (e.g. {line1, city, state}) or
 * a plain non-empty string — the spec allows "string/JSON". A bare
 * @IsObject() would reject the string form and a field with no validator at
 * all is stripped by the global whitelisting ValidationPipe, so this
 * permissive check whitelists the property while accepting both shapes.
 */
export function IsAddress(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isAddress',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (typeof value === 'string') {
            return value.trim().length > 0;
          }
          return (
            typeof value === 'object' && value !== null && !Array.isArray(value)
          );
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be a non-empty string or a JSON object`;
        },
      },
    });
  };
}
