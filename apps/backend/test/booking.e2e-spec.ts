import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

describe('Booking Concurrency (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  
  let token1: string;
  let token2: string;
  let slotId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);

    // Get or Create two users for concurrent testing
    const user1 = await prisma.user.upsert({
      where: { phone: 'test_concurrency_1' },
      update: {},
      create: { phone: 'test_concurrency_1', name: 'User 1' }
    });

    const user2 = await prisma.user.upsert({
      where: { phone: 'test_concurrency_2' },
      update: {},
      create: { phone: 'test_concurrency_2', name: 'User 2' }
    });

    // We will generate JWT tokens directly by calling the auth endpoints or manually.
    // Easiest is to simulate login to get a token
    const authRes1 = await request(app.getHttpServer())
      .post('/auth/send-otp')
      .send({ phone: 'test_concurrency_1' });
    
    const loginRes1 = await request(app.getHttpServer())
      .post('/auth/verify-otp')
      .send({ phone: 'test_concurrency_1', otp: '1234' });
    token1 = loginRes1.body.access_token;

    const authRes2 = await request(app.getHttpServer())
      .post('/auth/send-otp')
      .send({ phone: 'test_concurrency_2' });
    
    const loginRes2 = await request(app.getHttpServer())
      .post('/auth/verify-otp')
      .send({ phone: 'test_concurrency_2', otp: '1234' });
    token2 = loginRes2.body.access_token;

    // Create a fresh slot for testing concurrency
    const ground = await prisma.ground.findFirst();
    if (!ground) throw new Error("No ground found, please seed DB first");

    const slot = await prisma.timeSlot.create({
      data: {
        groundId: ground.id,
        startTime: new Date('2030-01-01T10:00:00.000Z'),
        endTime: new Date('2030-01-01T11:00:00.000Z'),
        price: 1000,
        isBlocked: false,
      }
    });
    slotId = slot.id;
  });

  afterAll(async () => {
    // Cleanup
    if (slotId) {
      await prisma.booking.deleteMany({
        where: { slotId }
      });
      await prisma.timeSlot.delete({
        where: { id: slotId }
      });
    }
    await prisma.user.deleteMany({
      where: { phone: { in: ['test_concurrency_1', 'test_concurrency_2'] } }
    });
    
    await app.close();
  });

  it('should prevent double booking using FOR UPDATE row locks', async () => {
    // We send two requests at the exact same time
    const req1 = request(app.getHttpServer())
      .post('/bookings')
      .set('Authorization', `Bearer ${token1}`)
      .send({ slotId });

    const req2 = request(app.getHttpServer())
      .post('/bookings')
      .set('Authorization', `Bearer ${token2}`)
      .send({ slotId });

    const [res1, res2] = await Promise.all([req1, req2]);

    // One must succeed (201 Created), one must fail (409 Conflict or 400 Bad Request)
    const statuses = [res1.status, res2.status];
    expect(statuses).toContain(201);
    
    // The failing one might be 400 (Bad Request from our service logic throwing ConflictException/BadRequestException)
    // We expect one to not be 201
    expect(statuses.filter(s => s === 201).length).toBe(1);
    
    // Check database to ensure exactly ONE booking was made
    const bookings = await prisma.booking.findMany({
      where: { slotId }
    });
    expect(bookings.length).toBe(1);
  });
});
