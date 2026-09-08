import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

describe('Player Flow Baseline (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const testPhone = '9999900000';
  let authToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    // Clean up test profile and user
    await prisma.profile.deleteMany({
      where: { user: { phone: testPhone } },
    });
    await prisma.user.deleteMany({
      where: { phone: testPhone },
    });
    await app.close();
  });

  it('1. POST /auth/send-otp should return OTP response', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/send-otp')
      .send({ phone: testPhone })
      .expect(200);

    expect(res.body).toHaveProperty('message');
    expect(res.body).toHaveProperty('dev_otp', '1234');
  });

  it('2. POST /auth/verify-otp should return JWT access_token', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/verify-otp')
      .send({ phone: testPhone, otp: '1234' })
      .expect(200);

    expect(res.body).toHaveProperty('access_token');
    expect(res.body).toHaveProperty('user');
    expect(res.body.user.phone).toBe(testPhone);
    authToken = res.body.access_token;
  });

  it('3. GET /users/me should return authenticated user profile', async () => {
    const res = await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(res.body.phone).toBe(testPhone);
    expect(res.body).toHaveProperty('profile');
    expect(res.body.profile).toHaveProperty('level');
    expect(res.body.profile).toHaveProperty('xp');
  });

  it('4. PUT /profiles/me should update and return profile', async () => {
    const res = await request(app.getHttpServer())
      .put('/profiles/me')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        avatar: 'https://example.com/avatar.png',
        favoriteSports: ['Football', 'Cricket'],
      })
      .expect(200);

    expect(res.body.avatar).toBe('https://example.com/avatar.png');
    expect(res.body.favoriteSports).toEqual(['Football', 'Cricket']);
  });

  it('5. GET /turfs should be public and return turfs with grounds', async () => {
    const res = await request(app.getHttpServer())
      .get('/turfs')
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    if (res.body.length > 0) {
      expect(res.body[0]).toHaveProperty('id');
      expect(res.body[0]).toHaveProperty('name');
      expect(res.body[0]).toHaveProperty('grounds');
    }
  });

  it('6. GET /games/public should be public and return games', async () => {
    const res = await request(app.getHttpServer())
      .get('/games/public')
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    if (res.body.length > 0) {
      expect(res.body[0]).toHaveProperty('id');
      expect(res.body[0]).toHaveProperty('sport');
      expect(res.body[0]).toHaveProperty('players');
    }
  });

  it('7. GET /bookings/my-bookings should return user booking history', async () => {
    const res = await request(app.getHttpServer())
      .get('/bookings/my-bookings')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
  });
});
