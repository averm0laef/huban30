import { Transform } from "class-transformer";
import {
  IsEmail,
  IsIn,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

import type { Role } from "@an30/contracts";

export class RegisterDto {
  @IsEmail()
  @MaxLength(254)
  @Transform(({ value }) => typeof value === "string" ? value.trim().toLowerCase() : value)
  email!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  displayName!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}

export class LoginDto {
  @IsEmail()
  @MaxLength(254)
  @Transform(({ value }) => typeof value === "string" ? value.trim().toLowerCase() : value)
  email!: string;

  @IsString()
  @MaxLength(128)
  password!: string;
}

export class TokenDto {
  @IsString()
  @MinLength(32)
  @MaxLength(256)
  token!: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  @MaxLength(254)
  @Transform(({ value }) => typeof value === "string" ? value.trim().toLowerCase() : value)
  email!: string;
}

export class ResetPasswordDto extends TokenDto {
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}

export class TotpCodeDto {
  @IsString()
  @Matches(/^(?:\d{6}|[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4})$/iu)
  code!: string;
}

export class InviteStaffDto {
  @IsEmail()
  @MaxLength(254)
  @Transform(({ value }) => typeof value === "string" ? value.trim().toLowerCase() : value)
  email!: string;

  @IsIn(["manager", "director", "admin"] satisfies Role[])
  role!: Exclude<Role, "customer">;
}

export class AcceptStaffInvitationDto extends TokenDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  displayName!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}
