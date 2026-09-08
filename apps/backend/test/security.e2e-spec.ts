import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, Controller, Get } from '@nestjs/common';
import request from 'supertest';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { Roles } from './../src/auth/roles.decorator';
import { Role } from '@prisma/client';

@Controller('test-security')
class RoleTestController {
  @Get('owner-only')
  @Roles(Role.TURF_OWNER)
  ownerOnly() {
    return { status: 'owner_granted' };
  }

  @Get('admin-only')
  @Roles(Role.ADMIN)
  adminOnly() {
    return { status: 'admin_granted' };
  }

  @Get('player-allowed')
  @Roles(Role.PLAYER)
  playerAllowed() {
    return { status: 'player_granted' };
  }
}

describe('Security & Authorization Hardening (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let port: number;

  const playerPhone = '9999900001';
  const ownerPhone = '9999900002';
  const adminPhone = '9999900003';

  let playerToken: string;
  let ownerToken: string;
  let adminToken: string;
  let playerUser: any;
  let testRoomId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [RoleTestController],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    await app.listen(0); // Random free port for websocket tests
    const address = app.getHttpServer().address();
    port = typeof address === 'string' ? 3000 : address.port;

    prisma = app.get<PrismaService>(PrismaService);
    jwtService = app.get<JwtService>(JwtService);

    // Create Player User
    playerUser = await prisma.user.upsert({
      where: { phone: playerPhone },
      update: { role: Role.PLAYER },
      create: { phone: playerPhone, role: Role.PLAYER, name: 'Security Player' },
    });
    playerToken = jwtService.sign({
      sub: playerUser.id,
      phone: playerUser.phone,
      role: playerUser.role,
    });

    // Create Owner User
    const ownerUser = await prisma.user.upsert({
      where: { phone: ownerPhone },
      update: { role: Role.TURF_OWNER },
      create: { phone: ownerPhone, role: Role.TURF_OWNER, name: 'Security Owner' },
    });
    ownerToken = jwtService.sign({
      sub: ownerUser.id,
      phone: ownerUser.phone,
      role: ownerUser.role,
    });

    // Create Admin User
    const adminUser = await prisma.user.upsert({
      where: { phone: adminPhone },
      update: { role: Role.ADMIN },
      create: { phone: adminPhone, role: Role.ADMIN, name: 'Security Admin' },
    });
    adminToken = jwtService.sign({
      sub: adminUser.id,
      phone: adminUser.phone,
      role: adminUser.role,
    });

    // Create a dummy chat room for testing
    const room = await prisma.chatRoom.create({
      data: {
        type: 'DIRECT',
        name: 'Test Security Room',
      },
    });
    testRoomId = room.id;
  });

  afterAll(async () => {
    // Cleanup
    if (testRoomId) {
      await prisma.chatMessage.deleteMany({ where: { roomId: testRoomId } });
      await prisma.chatRoom.delete({ where: { id: testRoomId } });
    }
    await prisma.user.deleteMany({
      where: { phone: { in: [playerPhone, ownerPhone, adminPhone] } },
    });
    await app.close();
  });

  describe('1. Public Routes', () => {
    it('GET /turfs should be accessible without JWT', async () => {
      await request(app.getHttpServer()).get('/turfs').expect(200);
    });

    it('GET /games/public should be accessible without JWT', async () => {
      await request(app.getHttpServer()).get('/games/public').expect(200);
    });
  });

  describe('2. JWT Authentication on Protected Routes', () => {
    it('GET /users/me without JWT should return 401 Unauthorized', async () => {
      await request(app.getHttpServer()).get('/users/me').expect(401);
    });

    it('GET /users/me with invalid JWT should return 401 Unauthorized', async () => {
      await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', 'Bearer invalid.tampered.token')
        .expect(401);
    });

    it('GET /users/me with expired JWT should return 401 Unauthorized', async () => {
      const expiredToken = jwtService.sign(
        { sub: playerUser.id, phone: playerUser.phone, role: playerUser.role },
        { expiresIn: '-10s' },
      );

      const res = await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);

      expect(res.body.message).toMatch(/expired|unauthorized/i);
    });

    it('GET /users/me with valid Player JWT should succeed', async () => {
      const res = await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${playerToken}`)
        .expect(200);

      expect(res.body.id).toBe(playerUser.id);
    });
  });

  describe('3. Role Authorization (RolesGuard)', () => {
    it('PLAYER accessing OWNER-only route should return 403 Forbidden', async () => {
      await request(app.getHttpServer())
        .get('/test-security/owner-only')
        .set('Authorization', `Bearer ${playerToken}`)
        .expect(403);
    });

    it('PLAYER accessing ADMIN-only route should return 403 Forbidden', async () => {
      await request(app.getHttpServer())
        .get('/test-security/admin-only')
        .set('Authorization', `Bearer ${playerToken}`)
        .expect(403);
    });

    it('OWNER accessing OWNER-only route should succeed', async () => {
      const res = await request(app.getHttpServer())
        .get('/test-security/owner-only')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(res.body.status).toBe('owner_granted');
    });

    it('ADMIN accessing ADMIN-only route should succeed', async () => {
      const res = await request(app.getHttpServer())
        .get('/test-security/admin-only')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.status).toBe('admin_granted');
    });

    it('PLAYER accessing PLAYER-allowed route should succeed', async () => {
      const res = await request(app.getHttpServer())
        .get('/test-security/player-allowed')
        .set('Authorization', `Bearer ${playerToken}`)
        .expect(200);

      expect(res.body.status).toBe('player_granted');
    });
  });

  describe('4. WebSocket Authentication & Spoofing Prevention', () => {
    it('WebSocket connection without JWT should be rejected / disconnected', (done) => {
      const socket = ioClient(`http://localhost:${port}`, {
        transports: ['websocket'],
        reconnection: false,
      });

      socket.on('connect', () => {
        // If it connected, it should get disconnected immediately by guard
      });

      socket.on('disconnect', () => {
        expect(socket.connected).toBe(false);
        socket.close();
        done();
      });

      setTimeout(() => {
        if (!socket.connected) {
          socket.close();
          done();
        }
      }, 1000);
    });

    it('WebSocket connection with valid JWT should be accepted', (done) => {
      const socket = ioClient(`http://localhost:${port}`, {
        transports: ['websocket'],
        auth: { token: playerToken },
        reconnection: false,
      });

      socket.on('connect', () => {
        expect(socket.connected).toBe(true);
        socket.close();
        done();
      });
    });

    it('WebSocket sendMessage should enforce socket.user.id and prevent senderId spoofing', async () => {
      const socket = ioClient(`http://localhost:${port}`, {
        transports: ['websocket'],
        auth: { token: playerToken },
        reconnection: false,
      });

      // Wait for connection
      await new Promise<void>((resolve, reject) => {
        socket.on('connect', resolve);
        socket.on('connect_error', reject);
        setTimeout(() => reject(new Error('connect timeout')), 5000);
      });

      // Join room and wait for history
      await new Promise<void>((resolve) => {
        socket.once('roomHistory', () => resolve());
        socket.emit('joinRoom', { roomId: testRoomId });
      });

      // Send message with spoofed senderId, wait for newMessage broadcast
      const msg = await new Promise<any>((resolve, reject) => {
        socket.once('newMessage', resolve);
        socket.emit('sendMessage', {
          roomId: testRoomId,
          content: 'Hello security test',
          senderId: 'fake-hacker-id',
        });
        setTimeout(() => reject(new Error('newMessage timeout')), 5000);
      });

      socket.close();

      expect(msg.content).toBe('Hello security test');
      // The senderId MUST match playerUser.id, NOT 'fake-hacker-id'
      expect(msg.senderId).toBe(playerUser.id);
      expect(msg.senderId).not.toBe('fake-hacker-id');

      // Verify in database as well
      const dbMsg = await prisma.chatMessage.findUnique({
        where: { id: msg.id },
      });
      expect(dbMsg).toBeDefined();
      expect(dbMsg?.senderId).toBe(playerUser.id);
    }, 15000);
  });
});
