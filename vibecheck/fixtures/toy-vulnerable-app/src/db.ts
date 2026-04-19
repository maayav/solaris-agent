export const db = {
  user: {
    delete: async (args: any) => ({ deleted: true }),
    findUnique: async (args: any) => ({ id: 1, email: 'test@example.com', role: 'user' }),
  },
  order: {
    findOne: async (args: any) => ({ id: 1, userId: 1 }),
    findUnique: async (args: any) => ({ id: 1, userId: 1 }),
  },
};
