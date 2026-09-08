import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  // Mocking OTP for MVP. In reality, integrate with MSG91 / Twilio etc.
  async sendOtp(phone: string) {
    if (!phone) {
      throw new BadRequestException('Phone number is required');
    }

    // For now, always return a static OTP '1234' for testing
    // or generate a random one and store in Redis.
    // We will just return success to simulate OTP sent.
    
    return {
      message: 'OTP sent successfully',
      dev_otp: '1234', // For easy testing without an SMS gateway
    };
  }

  async verifyOtp(phone: string, otp: string) {
    // Mock OTP verification
    if (otp !== '1234') {
      throw new UnauthorizedException('Invalid OTP');
    }

    // Find or create the user based on phone number
    let user = await this.prisma.user.findUnique({
      where: { phone },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          phone,
          profile: {
            create: {} // Create an empty profile by default
          }
        },
      });
    }

    const payload = { sub: user.id, phone: user.phone, role: user.role };
    
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        phone: user.phone,
        role: user.role,
      }
    };
  }
}
