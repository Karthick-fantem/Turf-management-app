import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "./../src/app.module";
import { PrismaService } from "./../src/prisma/prisma.service";
import { JwtService } from "@nestjs/jwt";
import { Role } from "@prisma/client";

describe("TimeSlot Engine (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  // Users
  let ownerAToken: string;
  let ownerBToken: string;
  let playerToken: string;
  let ownerAUser: any;
  let ownerBUser: any;

  // Turfs & Grounds
  let turfA: any;
  let turfB: any;
  let groundA: any; // owned by ownerA
  let groundB: any; // owned by ownerB

  // Track created IDs for cleanup
  const createdSlotIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    jwtService = app.get<JwtService>(JwtService);

    // Create Owner A
    ownerAUser = await prisma.user.upsert({
      where: { phone: "ts_owner_a" },
      update: { role: Role.TURF_OWNER },
      create: { phone: "ts_owner_a", name: "TS Owner A", role: Role.TURF_OWNER },
    });
    ownerAToken = jwtService.sign({ sub: ownerAUser.id, phone: ownerAUser.phone, role: ownerAUser.role });

    // Create Owner B
    ownerBUser = await prisma.user.upsert({
      where: { phone: "ts_owner_b" },
      update: { role: Role.TURF_OWNER },
      create: { phone: "ts_owner_b", name: "TS Owner B", role: Role.TURF_OWNER },
    });
    ownerBToken = jwtService.sign({ sub: ownerBUser.id, phone: ownerBUser.phone, role: ownerBUser.role });

    // Create Player
    const playerUser = await prisma.user.upsert({
      where: { phone: "ts_player" },
      update: { role: Role.PLAYER },
      create: { phone: "ts_player", name: "TS Player", role: Role.PLAYER },
    });
    playerToken = jwtService.sign({ sub: playerUser.id, phone: playerUser.phone, role: playerUser.role });

    // Turf A (owned by ownerA)
    turfA = await prisma.turf.create({
      data: { ownerId: ownerAUser.id, name: "TS Turf A", address: "Madurai" },
    });

    // Turf B (owned by ownerB)
    turfB = await prisma.turf.create({
      data: { ownerId: ownerBUser.id, name: "TS Turf B", address: "Madurai" },
    });

    // Ground A under Turf A
    groundA = await prisma.ground.create({
      data: { turfId: turfA.id, name: "TS Ground A", sport: "Football", price: 1000 },
    });

    // Ground B under Turf B
    groundB = await prisma.ground.create({
      data: { turfId: turfB.id, name: "TS Ground B", sport: "Cricket", price: 800 },
    });
  });

  afterAll(async () => {
    // Cleanup in order: gamePlayer → bookings → games → slots → grounds → turfs → users
    await prisma.gamePlayer.deleteMany({
      where: { game: { slot: { groundId: { in: [groundA.id, groundB.id] } } } },
    });
    await prisma.booking.deleteMany({ where: { slot: { groundId: { in: [groundA.id, groundB.id] } } } });
    await prisma.game.deleteMany({ where: { slot: { groundId: { in: [groundA.id, groundB.id] } } } });
    await prisma.timeSlot.deleteMany({ where: { groundId: { in: [groundA.id, groundB.id] } } });
    await prisma.ground.deleteMany({ where: { id: { in: [groundA.id, groundB.id] } } });
    await prisma.turf.deleteMany({ where: { id: { in: [turfA.id, turfB.id] } } });
    await prisma.user.deleteMany({
      where: { phone: { in: ["ts_owner_a", "ts_owner_b", "ts_player"] } },
    });
    await app.close();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. OWNER ISOLATION — CREATE
  // ──────────────────────────────────────────────────────────────────────────
  describe("1. Owner isolation — create", () => {
    it("Owner A can create a slot on their own ground (Ground A)", async () => {
      const res = await request(app.getHttpServer())
        .post("/timeslots")
        .set("Authorization", `Bearer ${ownerAToken}`)
        .send({
          groundId: groundA.id,
          startTime: "2030-01-01T07:00:00.000Z",
          endTime: "2030-01-01T08:00:00.000Z",
          price: 1000,
        });
      expect(res.status).toBe(201);
      expect(res.body.groundId).toBe(groundA.id);
      expect(res.body.price).toBe(1000);
      createdSlotIds.push(res.body.id);
    });

    it("Owner A cannot create a slot on Owner B's ground (Ground B)", async () => {
      const res = await request(app.getHttpServer())
        .post("/timeslots")
        .set("Authorization", `Bearer ${ownerAToken}`)
        .send({
          groundId: groundB.id,
          startTime: "2030-01-01T09:00:00.000Z",
          endTime: "2030-01-01T10:00:00.000Z",
          price: 800,
        });
      expect(res.status).toBe(403);
    });

    it("PLAYER cannot create a slot", async () => {
      const res = await request(app.getHttpServer())
        .post("/timeslots")
        .set("Authorization", `Bearer ${playerToken}`)
        .send({
          groundId: groundA.id,
          startTime: "2030-01-02T07:00:00.000Z",
          endTime: "2030-01-02T08:00:00.000Z",
          price: 1000,
        });
      expect(res.status).toBe(403);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. SLOT VALIDATION
  // ──────────────────────────────────────────────────────────────────────────
  describe("2. Slot validation", () => {
    it("startTime >= endTime is rejected (400)", async () => {
      const res = await request(app.getHttpServer())
        .post("/timeslots")
        .set("Authorization", `Bearer ${ownerAToken}`)
        .send({
          groundId: groundA.id,
          startTime: "2030-02-01T09:00:00.000Z",
          endTime: "2030-02-01T08:00:00.000Z", // end before start
          price: 1000,
        });
      expect(res.status).toBe(400);
    });

    it("startTime == endTime is rejected (400)", async () => {
      const res = await request(app.getHttpServer())
        .post("/timeslots")
        .set("Authorization", `Bearer ${ownerAToken}`)
        .send({
          groundId: groundA.id,
          startTime: "2030-02-01T09:00:00.000Z",
          endTime: "2030-02-01T09:00:00.000Z",
          price: 1000,
        });
      expect(res.status).toBe(400);
    });

    it("Negative price is rejected (400)", async () => {
      const res = await request(app.getHttpServer())
        .post("/timeslots")
        .set("Authorization", `Bearer ${ownerAToken}`)
        .send({
          groundId: groundA.id,
          startTime: "2030-03-01T07:00:00.000Z",
          endTime: "2030-03-01T08:00:00.000Z",
          price: -100,
        });
      expect(res.status).toBe(400);
    });

    it("Overlapping slot (07:00-08:00 + 07:30-08:30) is rejected (409)", async () => {
      // Create first slot
      const r1 = await request(app.getHttpServer())
        .post("/timeslots")
        .set("Authorization", `Bearer ${ownerAToken}`)
        .send({
          groundId: groundA.id,
          startTime: "2030-04-01T07:00:00.000Z",
          endTime: "2030-04-01T08:00:00.000Z",
          price: 1000,
        });
      expect(r1.status).toBe(201);
      createdSlotIds.push(r1.body.id);

      // Create overlapping slot
      const r2 = await request(app.getHttpServer())
        .post("/timeslots")
        .set("Authorization", `Bearer ${ownerAToken}`)
        .send({
          groundId: groundA.id,
          startTime: "2030-04-01T07:30:00.000Z",
          endTime: "2030-04-01T08:30:00.000Z",
          price: 1000,
        });
      expect(r2.status).toBe(409);
    });

    it("Adjacent slots (07:00-08:00 + 08:00-09:00) are allowed", async () => {
      // First slot already exists (07:00-08:00) from previous test
      const r2 = await request(app.getHttpServer())
        .post("/timeslots")
        .set("Authorization", `Bearer ${ownerAToken}`)
        .send({
          groundId: groundA.id,
          startTime: "2030-04-01T08:00:00.000Z",
          endTime: "2030-04-01T09:00:00.000Z",
          price: 1200,
        });
      expect(r2.status).toBe(201);
      createdSlotIds.push(r2.body.id);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. OWNER ISOLATION — UPDATE / BLOCK
  // ──────────────────────────────────────────────────────────────────────────
  describe("3. Owner isolation — update and block", () => {
    let slotForOwnerTests: any;

    beforeAll(async () => {
      slotForOwnerTests = await prisma.timeSlot.create({
        data: {
          groundId: groundA.id,
          startTime: new Date("2030-05-01T07:00:00.000Z"),
          endTime: new Date("2030-05-01T08:00:00.000Z"),
          price: 1000,
        },
      });
      createdSlotIds.push(slotForOwnerTests.id);
    });

    it("Owner A can update their own slot", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/timeslots/${slotForOwnerTests.id}`)
        .set("Authorization", `Bearer ${ownerAToken}`)
        .send({ price: 1100 });
      expect(res.status).toBe(200);
      expect(res.body.price).toBe(1100);
    });

    it("Owner B cannot update Owner A's slot (403)", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/timeslots/${slotForOwnerTests.id}`)
        .set("Authorization", `Bearer ${ownerBToken}`)
        .send({ price: 999 });
      expect(res.status).toBe(403);
    });

    it("Owner B cannot block Owner A's slot (403)", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/timeslots/${slotForOwnerTests.id}/block`)
        .set("Authorization", `Bearer ${ownerBToken}`);
      expect(res.status).toBe(403);
    });

    it("Owner A can block their own slot", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/timeslots/${slotForOwnerTests.id}/block`)
        .set("Authorization", `Bearer ${ownerAToken}`);
      expect(res.status).toBe(200);
      expect(res.body.isBlocked).toBe(true);
    });

    it("Owner A can unblock their own slot", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/timeslots/${slotForOwnerTests.id}/unblock`)
        .set("Authorization", `Bearer ${ownerAToken}`);
      expect(res.status).toBe(200);
      expect(res.body.isBlocked).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. BOOKED SLOT PROTECTION
  // ──────────────────────────────────────────────────────────────────────────
  describe("4. Booked slot protection", () => {
    let bookedSlot: any;
    let booking: any;
    let bookingPlayer: any;

    beforeAll(async () => {
      // Create a slot and then book it
      bookedSlot = await prisma.timeSlot.create({
        data: {
          groundId: groundA.id,
          startTime: new Date("2030-06-01T07:00:00.000Z"),
          endTime: new Date("2030-06-01T08:00:00.000Z"),
          price: 1500,
        },
      });
      createdSlotIds.push(bookedSlot.id);

      bookingPlayer = await prisma.user.upsert({
        where: { phone: "ts_booking_player" },
        update: {},
        create: { phone: "ts_booking_player", name: "TS Booking Player", role: Role.PLAYER },
      });

      booking = await prisma.booking.create({
        data: {
          userId: bookingPlayer.id,
          slotId: bookedSlot.id,
          totalAmount: 1500,
          status: "PENDING",
        },
      });
    });

    afterAll(async () => {
      await prisma.booking.delete({ where: { id: booking.id } });
      await prisma.user.delete({ where: { id: bookingPlayer.id } });
    });

    it("Cannot change time on a PENDING-booked slot (409)", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/timeslots/${bookedSlot.id}`)
        .set("Authorization", `Bearer ${ownerAToken}`)
        .send({ startTime: "2030-06-01T08:00:00.000Z", endTime: "2030-06-01T09:00:00.000Z" });
      expect(res.status).toBe(409);
    });

    it("Cannot change price on a PENDING-booked slot (409)", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/timeslots/${bookedSlot.id}`)
        .set("Authorization", `Bearer ${ownerAToken}`)
        .send({ price: 9999 });
      expect(res.status).toBe(409);
    });

    it("Cannot block a PENDING-booked slot (409)", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/timeslots/${bookedSlot.id}/block`)
        .set("Authorization", `Bearer ${ownerAToken}`);
      expect(res.status).toBe(409);
    });

    it("Cannot delete a PENDING-booked slot (409)", async () => {
      const res = await request(app.getHttpServer())
        .delete(`/timeslots/${bookedSlot.id}`)
        .set("Authorization", `Bearer ${ownerAToken}`);
      expect(res.status).toBe(409);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. UPDATE OVERLAP PROTECTION
  // ──────────────────────────────────────────────────────────────────────────
  describe("5. Update overlap protection", () => {
    let slotA: any;
    let slotB: any;

    beforeAll(async () => {
      slotA = await prisma.timeSlot.create({
        data: {
          groundId: groundA.id,
          startTime: new Date("2030-07-01T07:00:00.000Z"),
          endTime: new Date("2030-07-01T08:00:00.000Z"),
          price: 1000,
        },
      });
      slotB = await prisma.timeSlot.create({
        data: {
          groundId: groundA.id,
          startTime: new Date("2030-07-01T08:00:00.000Z"),
          endTime: new Date("2030-07-01T09:00:00.000Z"),
          price: 1000,
        },
      });
      createdSlotIds.push(slotA.id);
      createdSlotIds.push(slotB.id);
    });

    it("PATCH slot to same interval (no-op) succeeds", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/timeslots/${slotA.id}`)
        .set("Authorization", `Bearer ${ownerAToken}`)
        .send({
          startTime: "2030-07-01T07:00:00.000Z",
          endTime: "2030-07-01T08:00:00.000Z",
        });
      expect(res.status).toBe(200);
    });

    it("PATCH slotB to overlap slotA is rejected (409)", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/timeslots/${slotB.id}`)
        .set("Authorization", `Bearer ${ownerAToken}`)
        .send({
          startTime: "2030-07-01T07:30:00.000Z",
          endTime: "2030-07-01T08:30:00.000Z",
        });
      expect(res.status).toBe(409);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 6. DELETE — UNBOOKED
  // ──────────────────────────────────────────────────────────────────────────
  describe("6. Delete unbooked slot", () => {
    it("Owner can delete an unbooked slot", async () => {
      const slot = await prisma.timeSlot.create({
        data: {
          groundId: groundA.id,
          startTime: new Date("2030-08-01T07:00:00.000Z"),
          endTime: new Date("2030-08-01T08:00:00.000Z"),
          price: 1000,
        },
      });

      const res = await request(app.getHttpServer())
        .delete(`/timeslots/${slot.id}`)
        .set("Authorization", `Bearer ${ownerAToken}`);
      expect(res.status).toBe(200);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 7. PUBLIC PLAYER DISCOVERY
  // ──────────────────────────────────────────────────────────────────────────
  describe("7. Public player discovery", () => {
    let visibleSlot: any;
    let blockedSlot: any;
    let bookedSlot2: any;
    let bookingPlayer2: any;
    let booking2: any;

    beforeAll(async () => {
      // Available slot
      visibleSlot = await prisma.timeSlot.create({
        data: {
          groundId: groundA.id,
          startTime: new Date("2026-09-10T00:30:00.000Z"), // 06:00 IST on 2026-09-10
          endTime: new Date("2026-09-10T01:30:00.000Z"),   // 07:00 IST
          price: 1000,
        },
      });
      createdSlotIds.push(visibleSlot.id);

      // Blocked slot — should not appear in discovery
      blockedSlot = await prisma.timeSlot.create({
        data: {
          groundId: groundA.id,
          startTime: new Date("2026-09-10T02:00:00.000Z"), // 07:30 IST
          endTime: new Date("2026-09-10T03:00:00.000Z"),   // 08:30 IST
          price: 1200,
          isBlocked: true,
        },
      });
      createdSlotIds.push(blockedSlot.id);

      // Booked (PENDING) slot — should appear with isAvailable:false
      bookedSlot2 = await prisma.timeSlot.create({
        data: {
          groundId: groundA.id,
          startTime: new Date("2026-09-10T09:30:00.000Z"), // 15:00 IST
          endTime: new Date("2026-09-10T10:30:00.000Z"),   // 16:00 IST
          price: 1500,
        },
      });
      createdSlotIds.push(bookedSlot2.id);

      bookingPlayer2 = await prisma.user.upsert({
        where: { phone: "ts_booking_player2" },
        update: {},
        create: { phone: "ts_booking_player2", name: "TS Booking Player 2", role: Role.PLAYER },
      });

      booking2 = await prisma.booking.create({
        data: {
          userId: bookingPlayer2.id,
          slotId: bookedSlot2.id,
          totalAmount: 1500,
          status: "PENDING",
        },
      });
    });

    afterAll(async () => {
      await prisma.booking.delete({ where: { id: booking2.id } });
      await prisma.user.delete({ where: { id: bookingPlayer2.id } });
    });

    it("GET /turfs/:id/slots is accessible without JWT (public)", async () => {
      const res = await request(app.getHttpServer())
        .get(`/turfs/${turfA.id}/slots`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it("Date filtering works — returns slots on 2026-09-10 IST", async () => {
      const res = await request(app.getHttpServer())
        .get(`/turfs/${turfA.id}/slots?date=2026-09-10`);
      expect(res.status).toBe(200);
      const ids = res.body.map((s: any) => s.id);
      expect(ids).toContain(visibleSlot.id);
    });

    it("Blocked slot is excluded from discovery", async () => {
      const res = await request(app.getHttpServer())
        .get(`/turfs/${turfA.id}/slots?date=2026-09-10`);
      expect(res.status).toBe(200);
      const ids = res.body.map((s: any) => s.id);
      expect(ids).not.toContain(blockedSlot.id);
    });

    it("PENDING-booked slot appears with isAvailable=false", async () => {
      const res = await request(app.getHttpServer())
        .get(`/turfs/${turfA.id}/slots?date=2026-09-10`);
      expect(res.status).toBe(200);
      const found = res.body.find((s: any) => s.id === bookedSlot2.id);
      expect(found).toBeDefined();
      expect(found.isAvailable).toBe(false);
    });

    it("Available slot appears with isAvailable=true and correct price from DB", async () => {
      const res = await request(app.getHttpServer())
        .get(`/turfs/${turfA.id}/slots?date=2026-09-10`);
      expect(res.status).toBe(200);
      const found = res.body.find((s: any) => s.id === visibleSlot.id);
      expect(found).toBeDefined();
      expect(found.isAvailable).toBe(true);
      expect(found.price).toBe(1000); // server-authoritative from DB
    });

    it("Non-existent turf returns 404", async () => {
      const res = await request(app.getHttpServer())
        .get("/turfs/00000000-0000-0000-0000-000000000000/slots");
      expect(res.status).toBe(404);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 8. GAME SAFETY — no booking created
  // ──────────────────────────────────────────────────────────────────────────
  describe("8. Game creation — no slot reservation", () => {
    let gameSlot: any;
    let gameHost: any;
    let hostToken: string;

    beforeAll(async () => {
      gameSlot = await prisma.timeSlot.create({
        data: {
          groundId: groundA.id,
          startTime: new Date("2030-09-01T07:00:00.000Z"),
          endTime: new Date("2030-09-01T08:00:00.000Z"),
          price: 1000,
        },
      });
      createdSlotIds.push(gameSlot.id);

      gameHost = await prisma.user.upsert({
        where: { phone: "ts_game_host" },
        update: { role: Role.PLAYER },
        create: { phone: "ts_game_host", name: "TS Game Host", role: Role.PLAYER },
      });
      hostToken = jwtService.sign({ sub: gameHost.id, phone: gameHost.phone, role: gameHost.role });
    });

    afterAll(async () => {
      await prisma.gamePlayer.deleteMany({
        where: { OR: [{ game: { slotId: gameSlot.id } }, { userId: gameHost.id }] },
      });
      await prisma.game.deleteMany({
        where: { OR: [{ slotId: gameSlot.id }, { hostId: gameHost.id }] },
      });
      await prisma.user.deleteMany({ where: { id: gameHost.id } });
    });

    it("POST /games with valid slotId succeeds (201)", async () => {
      const res = await request(app.getHttpServer())
        .post("/games")
        .set("Authorization", `Bearer ${hostToken}`)
        .send({
          slotId: gameSlot.id,
          sport: "Football",
          minPlayers: 4,
          maxPlayers: 10,
          pricePerPlayer: 150,
          visibility: "PUBLIC",
        });
      expect(res.status).toBe(201);
    });

    it("Game creation does NOT create a Booking on the slot", async () => {
      const bookings = await prisma.booking.findMany({ where: { slotId: gameSlot.id } });
      expect(bookings.length).toBe(0);
    });

    it("POST /games with a blocked slot is rejected (409)", async () => {
      const blockedForGame = await prisma.timeSlot.create({
        data: {
          groundId: groundA.id,
          startTime: new Date("2030-10-01T07:00:00.000Z"),
          endTime: new Date("2030-10-01T08:00:00.000Z"),
          price: 1000,
          isBlocked: true,
        },
      });
      createdSlotIds.push(blockedForGame.id);

      const res = await request(app.getHttpServer())
        .post("/games")
        .set("Authorization", `Bearer ${hostToken}`)
        .send({
          slotId: blockedForGame.id,
          sport: "Football",
          minPlayers: 4,
          maxPlayers: 10,
          pricePerPlayer: 150,
        });
      expect(res.status).toBe(409);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 9. BOOKING CONCURRENCY — existing SELECT FOR UPDATE still works
  // ──────────────────────────────────────────────────────────────────────────
  describe("9. Booking concurrency (SELECT FOR UPDATE)", () => {
    let concSlot: any;
    let user1: any;
    let user2: any;
    let tok1: string;
    let tok2: string;

    beforeAll(async () => {
      concSlot = await prisma.timeSlot.create({
        data: {
          groundId: groundA.id,
          startTime: new Date("2030-11-01T07:00:00.000Z"),
          endTime: new Date("2030-11-01T08:00:00.000Z"),
          price: 1000,
        },
      });
      createdSlotIds.push(concSlot.id);

      user1 = await prisma.user.upsert({
        where: { phone: "ts_conc_1" },
        update: {},
        create: { phone: "ts_conc_1", name: "TS Conc 1", role: Role.PLAYER },
      });
      user2 = await prisma.user.upsert({
        where: { phone: "ts_conc_2" },
        update: {},
        create: { phone: "ts_conc_2", name: "TS Conc 2", role: Role.PLAYER },
      });
      tok1 = jwtService.sign({ sub: user1.id, phone: user1.phone, role: user1.role });
      tok2 = jwtService.sign({ sub: user2.id, phone: user2.phone, role: user2.role });
    });

    afterAll(async () => {
      await prisma.booking.deleteMany({ where: { slotId: concSlot.id } });
      await prisma.user.deleteMany({ where: { phone: { in: ["ts_conc_1", "ts_conc_2"] } } });
    });

    it("Concurrent booking requests: exactly 1 succeeds, 1 conflicts", async () => {
      const [r1, r2] = await Promise.all([
        request(app.getHttpServer())
          .post("/bookings")
          .set("Authorization", `Bearer ${tok1}`)
          .send({ slotId: concSlot.id }),
        request(app.getHttpServer())
          .post("/bookings")
          .set("Authorization", `Bearer ${tok2}`)
          .send({ slotId: concSlot.id }),
      ]);
      const statuses = [r1.status, r2.status];
      expect(statuses).toContain(201);
      expect(statuses.filter((s) => s === 201).length).toBe(1);

      const bookings = await prisma.booking.findMany({ where: { slotId: concSlot.id } });
      expect(bookings.length).toBe(1);
    });
  });
});
