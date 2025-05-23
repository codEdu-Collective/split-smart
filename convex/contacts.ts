import { mutation, type MutationCtx, query, type QueryCtx } from './_generated/server';
import { internal } from './_generated/api';
import { Doc } from './_generated/dataModel';
import type { Id } from './_generated/dataModel';
import { v } from 'convex/values';

export const getAllContacts = query({
    handler: async (
        ctx: QueryCtx,
    ): Promise<{
        users: { id: Id<'users'>; name: string; email: string; imageUrl?: string; type: string }[];
        groups: {
            id: Id<'groups'>;
            name: string;
            description: string;
            memberCount: number;
            type: string;
        }[];
        expensesPaid: Doc<'expenses'>[];
        expensesNotPaidByYou: Doc<'expenses'>[];
        personalExpenses: Doc<'expenses'>[];
    }> => {
        const currentUser: Doc<'users'> = await ctx.runQuery(internal.users.getCurrentUser);
        const expensesPaid: Doc<'expenses'>[] = await ctx.db
            .query('expenses')
            .withIndex('by_user_and_group', q =>
                q.eq('paidByUserId', currentUser._id).eq('groupId', undefined),
            )
            .collect();
        const expensesNotPaidByYou: Doc<'expenses'>[] = (
            await ctx.db
                .query('expenses')
                .withIndex('by_group', q => q.eq('groupId', undefined))
                .collect()
        ).filter(
            e =>
                e.paidByUserId !== currentUser._id &&
                e.splits.some(s => s.userId == currentUser._id),
        );

        const personalExpenses = [...expensesPaid, ...expensesNotPaidByYou];

        const contactsIds = new Set();
        personalExpenses.forEach(exp => {
            if (exp.paidByUserId !== currentUser._id) contactsIds.add(exp.paidByUserId);
            exp.splits.forEach(s => {
                if (s.userId !== currentUser._id) contactsIds.add(s.userId);
            });
        });
        const contactUsers = await Promise.all(
            [...contactsIds].map(async id => {
                const u = await ctx.db.get(id as Id<'users'>);
                return u
                    ? {
                          id: u._id,
                          name: u.name,
                          email: u.email,
                          imageUrl: u.imageUrl,
                          type: 'user',
                      }
                    : null;
            }),
        );

        const allGroups: Doc<'groups'>[] = await ctx.db.query('groups').collect();

        const userGroups = allGroups
            .filter(g => g.members.some(m => m.userId === currentUser._id))
            .map(g => ({
                id: g._id,
                name: g.name,
                description: g.description ?? '',
                memberCount: g.members.length,
                type: 'group',
            }));

        userGroups.sort((a, b) => a.name.localeCompare(b.name));

        return {
            users: contactUsers.filter(u => u !== null),
            groups: userGroups,
            expensesPaid,
            expensesNotPaidByYou,
            personalExpenses,
        };
    },
});

export const createGroup = mutation({
    args: {
        name: v.string(),
        home: v.string(),
        descripton: v.optional(v.string()),
        members: v.array(v.id('users')),
    },
    handler: async (
        ctx: MutationCtx,
        args: {
            name: string;
            home: string;
            descripton: string;
            members: Id<'users'>[];
        },
    ): Promise<Id<'groups'>> => {
        const currentUser = await ctx.runQuery(internal.users.getCurrentUser);

        if (!args.name.trim()) throw new Error('Group name cannot be empty');

        const uniqueMembers = new Set<Id<'users'>>(args.members);
        uniqueMembers.add(currentUser._id);

        for (const id of uniqueMembers) {
            const userExists = await ctx.db.get(id);
            if (!userExists) throw new Error('User with ID ${id} not found');
        }
        return await ctx.db.insert('groups', {
            name: args.name.trim(),
            description: args.descripton?.trim() ?? '',
            createdBy: currentUser._id,
            members: [...uniqueMembers].map(id => ({
                userId: id,
                role: id === currentUser._id ? 'admin' : 'member',
                joinedAt: Date.now(),
            })),
        });
    },
});
