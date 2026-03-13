import { Server } from "socket.io";
import { Server as HttpServer } from "http";

let ioInstance: Server;

export const initSocket = (server: HttpServer): Server => {
  ioInstance = new Server(server, {
    cors: {
      origin: "*",
    },
  });
  return ioInstance;
};

export const getIO = (): Server => {
  if (!ioInstance) {
    throw new Error("Socket.io has not been initialized. Please call initSocket first.");
  }
  return ioInstance;
};
