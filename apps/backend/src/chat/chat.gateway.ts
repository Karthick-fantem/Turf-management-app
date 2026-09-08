import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : [
      'http://localhost:5050',
      'http://127.0.0.1:5050',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:8080',
    ];

@WebSocketGateway({
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async handleConnection(client: Socket) {
    client.data.userPromise = (async () => {
      try {
        const authHeader = client.handshake.auth?.token || client.handshake.headers?.authorization;
        if (!authHeader) {
          client.disconnect(true);
          return null;
        }

        const token =
          typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
            ? authHeader.substring(7)
            : authHeader;

        const secret = process.env.JWT_SECRET;
        const payload = this.jwtService.verify(token, { secret });
        if (!payload || !payload.sub) {
          client.disconnect(true);
          return null;
        }

        const user = await this.prisma.user.findUnique({
          where: { id: payload.sub },
        });

        if (!user) {
          client.disconnect(true);
          return null;
        }

        client.data.user = user;
        return user;
      } catch {
        client.disconnect(true);
        return null;
      }
    })();

    await client.data.userPromise;
  }

  handleDisconnect(client: Socket) {
    // Cleanup on disconnect
  }

  private async getAuthenticatedUser(client: Socket) {
    if (client.data?.user) return client.data.user;
    if (client.data?.userPromise) return await client.data.userPromise;
    return null;
  }

  @SubscribeMessage('joinRoom')
  async handleJoinRoom(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const user = await this.getAuthenticatedUser(client);
    if (!user) {
      client.disconnect(true);
      return;
    }

    await client.join(data.roomId);

    // Load last 50 chat messages
    const messages = await this.prisma.chatMessage.findMany({
      where: { roomId: data.roomId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    client.emit('roomHistory', messages.reverse());
  }

  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @MessageBody() payload: { roomId: string; content: string; senderId?: string },
    @ConnectedSocket() client: Socket,
  ) {
    const user = await this.getAuthenticatedUser(client);
    if (!user) {
      client.disconnect(true);
      return;
    }

    if (!payload.content || !payload.roomId) {
      throw new WsException('Invalid message payload');
    }

    // Authoritative sender ID from authenticated socket session — cannot be spoofed by client payload
    const message = await this.prisma.chatMessage.create({
      data: {
        roomId: payload.roomId,
        senderId: user.id,
        content: payload.content,
      },
    });

    this.server.to(payload.roomId).emit('newMessage', message);
  }
}

