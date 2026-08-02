import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";

import { Public, RequirePermissions } from "../auth/auth.decorators.js";
import { RateLimitService } from "../security/rate-limit.service.js";
import { AccountService } from "./account.service.js";
import { PublicStorefrontService } from "./public-storefront.service.js";

function metadata(request: FastifyRequest) {
  const userAgent = request.headers["user-agent"];
  return { ipAddress: request.ip, userAgent: typeof userAgent === "string" ? userAgent : undefined };
}

@Public()
@Controller("public")
export class PublicStorefrontController {
  constructor(
    private readonly rateLimit: RateLimitService,
    private readonly storefront: PublicStorefrontService,
  ) {}

  @Get("settings")
  @Header("Cache-Control", "public, max-age=60, stale-while-revalidate=300")
  async settings(@Req() request: FastifyRequest) {
    await this.rateLimit.consume("public-settings", request.ip, 120, 60);
    return this.storefront.settings();
  }

  @Get("content/:slug")
  @Header("Cache-Control", "public, max-age=60, stale-while-revalidate=300")
  async content(@Param("slug") slug: string, @Req() request: FastifyRequest) {
    await this.rateLimit.consume("public-content", request.ip, 120, 60);
    return this.storefront.content(slug);
  }

  @Get("banners")
  @Header("Cache-Control", "public, max-age=60, stale-while-revalidate=300")
  async banners(@Query() query: unknown, @Req() request: FastifyRequest) {
    await this.rateLimit.consume("public-banners", request.ip, 120, 60);
    return this.storefront.banners(query);
  }

  @Get("media/:objectId")
  async media(
    @Param("objectId") objectId: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    await this.rateLimit.consume("public-media", request.ip, 120, 60);
    const media = await this.storefront.media(objectId, request.headers["if-none-match"]);
    reply
      .header("Cache-Control", "public, max-age=86400, immutable")
      .header("ETag", media.etag)
      .header("X-Content-Type-Options", "nosniff");
    if (media.content === null) {
      return reply.code(304).send();
    }
    return reply
      .header("Content-Type", media.mimeType)
      .send(media.content);
  }
}

@Public()
@Controller("contact-requests")
export class ContactRequestsController {
  constructor(
    private readonly rateLimit: RateLimitService,
    private readonly storefront: PublicStorefrontService,
  ) {}

  @Post()
  async create(@Body() body: unknown, @Req() request: FastifyRequest) {
    const contact = typeof body === "object" && body !== null && "email" in body
      && typeof body.email === "string" ? body.email.toLowerCase() : request.ip;
    await Promise.all([
      this.rateLimit.consume("contact-request-ip", request.ip, 10, 3_600),
      this.rateLimit.consume("contact-request-contact", contact, 5, 3_600),
    ]);
    return this.storefront.createContactRequest(body, metadata(request));
  }
}

@Controller("account")
export class AccountController {
  constructor(
    private readonly account: AccountService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @RequirePermissions("account:read:self")
  @Get()
  read(@Req() request: FastifyRequest) {
    return this.account.read(request.authContext!);
  }

  @RequirePermissions("account:update:self")
  @Patch()
  async update(@Body() body: unknown, @Req() request: FastifyRequest) {
    await this.rateLimit.consume("account-update", request.authContext!.userId, 30, 3_600);
    return this.account.update(body, request.authContext!, metadata(request));
  }

  @RequirePermissions("account:update:self")
  @Put("password")
  async changePassword(@Body() body: unknown, @Req() request: FastifyRequest) {
    await this.rateLimit.consume("account-password", request.authContext!.userId, 5, 3_600);
    return this.account.changePassword(body, request.authContext!, metadata(request));
  }

  @RequirePermissions("wishlist:manage:self")
  @Get("wishlist")
  wishlist(@Query() query: unknown, @Req() request: FastifyRequest) {
    return this.account.wishlist(query, request.authContext!);
  }

  @RequirePermissions("wishlist:manage:self")
  @Post("wishlist")
  async addWishlist(@Body() body: unknown, @Req() request: FastifyRequest) {
    await this.rateLimit.consume("wishlist-update", request.authContext!.userId, 120, 3_600);
    return this.account.addWishlist(body, request.authContext!);
  }

  @RequirePermissions("wishlist:manage:self")
  @Delete("wishlist/:productId")
  removeWishlist(@Param("productId") productId: string, @Req() request: FastifyRequest) {
    return this.account.removeWishlist(productId, request.authContext!);
  }

  @RequirePermissions("account:read:self")
  @Get("history")
  history(@Query() query: unknown, @Req() request: FastifyRequest) {
    return this.account.history(query, request.authContext!);
  }

  @RequirePermissions("account:update:self")
  @Post("history")
  async recordHistory(@Body() body: unknown, @Req() request: FastifyRequest) {
    await this.rateLimit.consume("history-record", request.authContext!.userId, 600, 3_600);
    return this.account.recordView(body, request.authContext!);
  }

  @RequirePermissions("account:update:self")
  @Delete("history")
  @HttpCode(204)
  clearHistory(@Req() request: FastifyRequest) {
    return this.account.clearHistory(request.authContext!);
  }

  @RequirePermissions("account:read:self")
  @Get("addresses")
  addresses(@Req() request: FastifyRequest) {
    return this.account.addresses(request.authContext!);
  }

  @RequirePermissions("account:update:self")
  @Post("addresses")
  async createAddress(@Body() body: unknown, @Req() request: FastifyRequest) {
    await this.rateLimit.consume("address-create", request.authContext!.userId, 20, 86_400);
    return this.account.createAddress(body, request.authContext!, metadata(request));
  }

  @RequirePermissions("account:update:self")
  @Patch("addresses/:addressId")
  async updateAddress(
    @Param("addressId") addressId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ) {
    await this.rateLimit.consume("address-update", request.authContext!.userId, 100, 86_400);
    return this.account.updateAddress(addressId, body, request.authContext!, metadata(request));
  }

  @RequirePermissions("account:update:self")
  @Delete("addresses/:addressId")
  @HttpCode(204)
  async deleteAddress(@Param("addressId") addressId: string, @Req() request: FastifyRequest) {
    await this.rateLimit.consume("address-delete", request.authContext!.userId, 20, 86_400);
    return this.account.deleteAddress(addressId, request.authContext!, metadata(request));
  }
}
