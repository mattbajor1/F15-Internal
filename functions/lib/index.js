"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkEquipmentMaintenance = exports.checkOverdueInvoices = exports.api = exports.authMiddleware = void 0;
/* eslint-disable max-len */
const https_1 = require("firebase-functions/v2/https");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const v2_1 = require("firebase-functions/v2");
const admin = __importStar(require("firebase-admin"));
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
// Set global options for all functions
(0, v2_1.setGlobalOptions)({ maxInstances: 10 });
admin.initializeApp();
const db = admin.firestore();
const storage = admin.storage();
const app = (0, express_1.default)();
app.use((0, cors_1.default)({ origin: true }));
app.use(express_1.default.json());
app.use((req, res, next) => {
    var _a;
    console.log(`${req.method} ${req.path}`, {
        body: req.body,
        user: (_a = req.user) === null || _a === void 0 ? void 0 : _a.uid,
    });
    next();
});
const authMiddleware = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            res.status(401).json({ error: 'Unauthorized: No token provided' });
            return;
        }
        const token = authHeader.split('Bearer ')[1];
        const decodedToken = await admin.auth().verifyIdToken(token);
        req.user = {
            uid: decodedToken.uid,
            email: decodedToken.email,
        };
        next();
    }
    catch (error) {
        console.error('Auth error:', error);
        res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
};
exports.authMiddleware = authMiddleware;
async function isProjectMember(projectId, userId) {
    var _a;
    const projectDoc = await db.collection('projects').doc(projectId).get();
    if (!projectDoc.exists)
        return false;
    const data = projectDoc.data();
    return ((_a = data.teamMembers) === null || _a === void 0 ? void 0 : _a.some((member) => member.userId === userId)) || false;
}
async function isProjectOwner(projectId, userId) {
    const projectDoc = await db.collection('projects').doc(projectId).get();
    if (!projectDoc.exists)
        return false;
    const data = projectDoc.data();
    return data.ownerId === userId;
}
app.get('/api/dashboard', exports.authMiddleware, async (req, res) => {
    try {
        const uid = req.user.uid;
        const projectsSnapshot = await db.collection('projects')
            .where('teamMembers', 'array-contains-any', [{ userId: uid }])
            .get();
        const projectIds = projectsSnapshot.docs.map((doc) => doc.id);
        const activeProjects = projectsSnapshot.docs.filter((doc) => doc.data().status === 'active').length;
        let openTasks = 0;
        for (const projectId of projectIds) {
            const tasksSnapshot = await db.collection('projects')
                .doc(projectId)
                .collection('tasks')
                .where('completed', '==', false)
                .get();
            openTasks += tasksSnapshot.size;
        }
        const equipmentSnapshot = await db.collection('equipment').get();
        const totalEquipment = equipmentSnapshot.size;
        const availableEquipment = equipmentSnapshot.docs.filter((doc) => doc.data().status === 'Available').length;
        const equipmentAvailability = totalEquipment > 0 ?
            Math.round((availableEquipment / totalEquipment) * 100) :
            100;
        const recentProjects = projectsSnapshot.docs
            .sort((a, b) => {
            var _a, _b;
            const aDate = ((_a = a.data().updatedAt) === null || _a === void 0 ? void 0 : _a.toDate()) || new Date(0);
            const bDate = ((_b = b.data().updatedAt) === null || _b === void 0 ? void 0 : _b.toDate()) || new Date(0);
            return bDate.getTime() - aDate.getTime();
        })
            .slice(0, 5)
            .map((doc) => (Object.assign({ id: doc.id }, doc.data())));
        res.json({
            metrics: {
                activeProjects,
                openTasks,
                equipmentAvailability,
            },
            recentProjects,
        });
    }
    catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.get('/api/projects', exports.authMiddleware, async (req, res) => {
    try {
        const uid = req.user.uid;
        const projectsSnapshot = await db.collection('projects')
            .where('teamMembers', 'array-contains-any', [{ userId: uid }])
            .orderBy('createdAt', 'desc')
            .get();
        const projects = projectsSnapshot.docs.map((doc) => (Object.assign({ id: doc.id }, doc.data())));
        res.json({ projects });
    }
    catch (error) {
        console.error('List projects error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.post('/api/projects', exports.authMiddleware, async (req, res) => {
    try {
        const uid = req.user.uid;
        const { name, description, status, startDate, endDate, locations } = req.body;
        if (!name) {
            res.status(400).json({ error: 'Project name is required' });
            return;
        }
        const userDoc = await db.collection('users').doc(uid).get();
        const userData = userDoc.data();
        const newProject = {
            name,
            description: description || '',
            status: status || 'planning',
            startDate: startDate || null,
            endDate: endDate || null,
            locations: locations || [],
            ownerId: uid,
            teamMembers: [{
                    userId: uid,
                    role: 'Owner',
                    name: (userData === null || userData === void 0 ? void 0 : userData.displayName) || (userData === null || userData === void 0 ? void 0 : userData.email) || 'Unknown',
                    avatar: (userData === null || userData === void 0 ? void 0 : userData.photoURL) || null,
                }],
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        const docRef = await db.collection('projects').add(newProject);
        res.status(201).json(Object.assign(Object.assign({ id: docRef.id }, newProject), { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
    }
    catch (error) {
        console.error('Create project error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.get('/api/projects/:id', exports.authMiddleware, async (req, res) => {
    try {
        const uid = req.user.uid;
        const projectId = req.params.id;
        if (!await isProjectMember(projectId, uid)) {
            res.status(403).json({ error: 'Access denied' });
            return;
        }
        const projectDoc = await db.collection('projects').doc(projectId).get();
        if (!projectDoc.exists) {
            res.status(404).json({ error: 'Project not found' });
            return;
        }
        res.json(Object.assign({ id: projectDoc.id }, projectDoc.data()));
    }
    catch (error) {
        console.error('Get project error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.patch('/api/projects/:id', exports.authMiddleware, async (req, res) => {
    try {
        const uid = req.user.uid;
        const projectId = req.params.id;
        if (!await isProjectOwner(projectId, uid)) {
            res.status(403).json({ error: 'Only project owner can update' });
            return;
        }
        const updates = req.body;
        delete updates.ownerId;
        delete updates.createdAt;
        updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        await db.collection('projects').doc(projectId).update(updates);
        res.json({ success: true });
    }
    catch (error) {
        console.error('Update project error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.delete('/api/projects/:id', exports.authMiddleware, async (req, res) => {
    try {
        const uid = req.user.uid;
        const projectId = req.params.id;
        if (!await isProjectOwner(projectId, uid)) {
            res.status(403).json({ error: 'Only project owner can delete' });
            return;
        }
        const batch = db.batch();
        const collections = ['tasks', 'equipment', 'marketing', 'invoices', 'documents'];
        for (const collectionName of collections) {
            const snapshot = await db.collection('projects')
                .doc(projectId)
                .collection(collectionName)
                .get();
            snapshot.docs.forEach((doc) => {
                batch.delete(doc.ref);
            });
        }
        batch.delete(db.collection('projects').doc(projectId));
        await batch.commit();
        res.json({ success: true });
    }
    catch (error) {
        console.error('Delete project error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.post('/api/projects/:id/team', exports.authMiddleware, async (req, res) => {
    var _a;
    try {
        const uid = req.user.uid;
        const projectId = req.params.id;
        const { userId, role, name, avatar } = req.body;
        if (!await isProjectOwner(projectId, uid)) {
            res.status(403).json({ error: 'Only project owner can add members' });
            return;
        }
        const projectDoc = await db.collection('projects').doc(projectId).get();
        const teamMembers = ((_a = projectDoc.data()) === null || _a === void 0 ? void 0 : _a.teamMembers) || [];
        if (teamMembers.some((m) => m.userId === userId)) {
            res.status(400).json({ error: 'User already in team' });
            return;
        }
        teamMembers.push({ userId, role, name, avatar: avatar || null });
        await db.collection('projects').doc(projectId).update({
            teamMembers,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        res.json({ success: true });
    }
    catch (error) {
        console.error('Add team member error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.delete('/api/projects/:id/team/:userId', exports.authMiddleware, async (req, res) => {
    var _a, _b;
    try {
        const uid = req.user.uid;
        const projectId = req.params.id;
        const userIdToRemove = req.params.userId;
        if (!await isProjectOwner(projectId, uid)) {
            res.status(403).json({ error: 'Only project owner can remove members' });
            return;
        }
        const projectDoc = await db.collection('projects').doc(projectId).get();
        const ownerId = (_a = projectDoc.data()) === null || _a === void 0 ? void 0 : _a.ownerId;
        if (userIdToRemove === ownerId) {
            res.status(400).json({ error: 'Cannot remove project owner' });
            return;
        }
        const teamMembers = ((_b = projectDoc.data()) === null || _b === void 0 ? void 0 : _b.teamMembers) || [];
        const updatedTeam = teamMembers.filter((m) => m.userId !== userIdToRemove);
        await db.collection('projects').doc(projectId).update({
            teamMembers: updatedTeam,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        res.json({ success: true });
    }
    catch (error) {
        console.error('Remove team member error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.get('/api/projects/:id/tasks', exports.authMiddleware, async (req, res) => {
    try {
        const uid = req.user.uid;
        const projectId = req.params.id;
        if (!await isProjectMember(projectId, uid)) {
            res.status(403).json({ error: 'Access denied' });
            return;
        }
        const tasksSnapshot = await db.collection('projects')
            .doc(projectId)
            .collection('tasks')
            .orderBy('dueDate', 'asc')
            .get();
        const tasks = tasksSnapshot.docs.map((doc) => (Object.assign({ id: doc.id }, doc.data())));
        res.json({ tasks });
    }
    catch (error) {
        console.error('List tasks error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.post('/api/projects/:id/tasks', exports.authMiddleware, async (req, res) => {
    try {
        const uid = req.user.uid;
        const projectId = req.params.id;
        const { title, description, stage, dueDate, assignedTo } = req.body;
        if (!await isProjectMember(projectId, uid)) {
            res.status(403).json({ error: 'Access denied' });
            return;
        }
        if (!title || !stage) {
            res.status(400).json({ error: 'Title and stage are required' });
            return;
        }
        const newTask = {
            title,
            description: description || '',
            stage,
            dueDate: dueDate || null,
            assignedTo: assignedTo || [],
            completed: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        const docRef = await db.collection('projects')
            .doc(projectId)
            .collection('tasks')
            .add(newTask);
        res.status(201).json(Object.assign(Object.assign({ id: docRef.id }, newTask), { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
    }
    catch (error) {
        console.error('Create task error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.patch('/api/projects/:projectId/tasks/:taskId', exports.authMiddleware, async (req, res) => {
    try {
        const uid = req.user.uid;
        const { projectId, taskId } = req.params;
        if (!await isProjectMember(projectId, uid)) {
            res.status(403).json({ error: 'Access denied' });
            return;
        }
        const updates = req.body;
        updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        await db.collection('projects')
            .doc(projectId)
            .collection('tasks')
            .doc(taskId)
            .update(updates);
        res.json({ success: true });
    }
    catch (error) {
        console.error('Update task error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.delete('/api/projects/:projectId/tasks/:taskId', exports.authMiddleware, async (req, res) => {
    try {
        const uid = req.user.uid;
        const { projectId, taskId } = req.params;
        if (!await isProjectMember(projectId, uid)) {
            res.status(403).json({ error: 'Access denied' });
            return;
        }
        await db.collection('projects')
            .doc(projectId)
            .collection('tasks')
            .doc(taskId)
            .delete();
        res.json({ success: true });
    }
    catch (error) {
        console.error('Delete task error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.get('/api/projects/:id/equipment', exports.authMiddleware, async (req, res) => {
    try {
        const uid = req.user.uid;
        const projectId = req.params.id;
        if (!await isProjectMember(projectId, uid)) {
            res.status(403).json({ error: 'Access denied' });
            return;
        }
        const equipmentSnapshot = await db.collection('projects')
            .doc(projectId)
            .collection('equipment')
            .get();
        const equipment = equipmentSnapshot.docs.map((doc) => (Object.assign({ id: doc.id }, doc.data())));
        res.json({ equipment });
    }
    catch (error) {
        console.error('List equipment error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.post('/api/projects/:id/equipment', exports.authMiddleware, async (req, res) => {
    try {
        const uid = req.user.uid;
        const projectId = req.params.id;
        const { equipmentId, rentalPrice, notes } = req.body;
        if (!await isProjectMember(projectId, uid)) {
            res.status(403).json({ error: 'Access denied' });
            return;
        }
        const equipmentDoc = await db.collection('equipment').doc(equipmentId).get();
        if (!equipmentDoc.exists) {
            res.status(404).json({ error: 'Equipment not found' });
            return;
        }
        const equipmentData = equipmentDoc.data();
        const assignment = {
            equipmentId,
            name: equipmentData.name,
            category: equipmentData.category,
            rentalPrice: rentalPrice || 0,
            notes: notes || '',
            assignedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        const docRef = await db.collection('projects')
            .doc(projectId)
            .collection('equipment')
            .add(assignment);
        await db.collection('equipment').doc(equipmentId).update({
            status: 'In Use',
            currentProjectId: projectId,
        });
        res.status(201).json(Object.assign(Object.assign({ id: docRef.id }, assignment), { assignedAt: new Date().toISOString() }));
    }
    catch (error) {
        console.error('Assign equipment error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.delete('/api/projects/:projectId/equipment/:assignmentId', exports.authMiddleware, async (req, res) => {
    var _a;
    try {
        const uid = req.user.uid;
        const { projectId, assignmentId } = req.params;
        if (!await isProjectMember(projectId, uid)) {
            res.status(403).json({ error: 'Access denied' });
            return;
        }
        const assignmentDoc = await db.collection('projects')
            .doc(projectId)
            .collection('equipment')
            .doc(assignmentId)
            .get();
        if (assignmentDoc.exists) {
            const equipmentId = (_a = assignmentDoc.data()) === null || _a === void 0 ? void 0 : _a.equipmentId;
            await db.collection('equipment').doc(equipmentId).update({
                status: 'Available',
                currentProjectId: null,
            });
        }
        await db.collection('projects')
            .doc(projectId)
            .collection('equipment')
            .doc(assignmentId)
            .delete();
        res.json({ success: true });
    }
    catch (error) {
        console.error('Remove equipment error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.get('/api/projects/:id/marketing', exports.authMiddleware, async (req, res) => {
    try {
        const uid = req.user.uid;
        const projectId = req.params.id;
        if (!await isProjectMember(projectId, uid)) {
            res.status(403).json({ error: 'Access denied' });
            return;
        }
        const marketingSnapshot = await db.collection('projects')
            .doc(projectId)
            .collection('marketing')
            .orderBy('scheduledDate', 'desc')
            .get();
        const marketing = marketingSnapshot.docs.map((doc) => (Object.assign({ id: doc.id }, doc.data())));
        res.json({ marketing });
    }
    catch (error) {
        console.error('List marketing error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.post('/api/projects/:id/marketing', exports.authMiddleware, async (req, res) => {
    try {
        const uid = req.user.uid;
        const projectId = req.params.id;
        const { copy, platforms, status, scheduledDate, imageUrl } = req.body;
        if (!await isProjectMember(projectId, uid)) {
            res.status(403).json({ error: 'Access denied' });
            return;
        }
        if (!copy || !platforms || platforms.length === 0) {
            res.status(400).json({ error: 'Copy and platforms are required' });
            return;
        }
        const newContent = {
            copy,
            platforms,
            status: status || 'draft',
            scheduledDate: scheduledDate || null,
            imageUrl: imageUrl || null,
            createdBy: uid,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        const docRef = await db.collection('projects')
            .doc(projectId)
            .collection('marketing')
            .add(newContent);
        res.status(201).json(Object.assign(Object.assign({ id: docRef.id }, newContent), { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
    }
    catch (error) {
        console.error('Create marketing error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.patch('/api/projects/:projectId/marketing/:marketingId', exports.authMiddleware, async (req, res) => {
    try {
        const uid = req.user.uid;
        const { projectId, marketingId } = req.params;
        if (!await isProjectMember(projectId, uid)) {
            res.status(403).json({ error: 'Access denied' });
            return;
        }
        const updates = req.body;
        updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        await db.collection('projects')
            .doc(projectId)
            .collection('marketing')
            .doc(marketingId)
            .update(updates);
        res.json({ success: true });
    }
    catch (error) {
        console.error('Update marketing error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.delete('/api/projects/:projectId/marketing/:marketingId', exports.authMiddleware, async (req, res) => {
    try {
        const uid = req.user.uid;
        const { projectId, marketingId } = req.params;
        if (!await isProjectMember(projectId, uid)) {
            res.status(403).json({ error: 'Access denied' });
            return;
        }
        await db.collection('projects')
            .doc(projectId)
            .collection('marketing')
            .doc(marketingId)
            .delete();
        res.json({ success: true });
    }
    catch (error) {
        console.error('Delete marketing error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.post('/api/projects/:id/marketing/generate', exports.authMiddleware, async (req, res) => {
    try {
        const uid = req.user.uid;
        const projectId = req.params.id;
        const { projectDetails, targetAudience, campaignGoals, tone } = req.body;
        if (!await isProjectMember(projectId, uid)) {
            res.status(403).json({ error: 'Access denied' });
            return;
        }
        const variations = [
            `🎬 Exciting news! ${projectDetails}. We're bringing this vision to life for ${targetAudience}. ${campaignGoals} #Production #FilmMaking`,
            `✨ Behind the scenes magic happening now! Our latest project is designed specifically for ${targetAudience}. ${campaignGoals} Stay tuned! 🎥`,
            `🎯 Big reveal coming soon! We're working on something special that ${targetAudience} will love. ${campaignGoals} #ComingSoon #Production`,
        ];
        res.json({
            variations,
            metadata: {
                projectDetails,
                targetAudience,
                campaignGoals,
                tone: tone || 'professional and engaging',
            },
        });
    }
    catch (error) {
        console.error('Generate marketing copy error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.get('/api/projects/:id/invoices', exports.authMiddleware, async (req, res) => {
    try {
        const uid = req.user.uid;
        const projectId = req.params.id;
        if (!await isProjectMember(projectId, uid)) {
            res.status(403).json({ error: 'Access denied' });
            return;
        }
        const invoicesSnapshot = await db.collection('projects')
            .doc(projectId)
            .collection('invoices')
            .orderBy('dueDate', 'desc')
            .get();
        const invoices = invoicesSnapshot.docs.map((doc) => (Object.assign({ id: doc.id }, doc.data())));
        res.json({ invoices });
    }
    catch (error) {
        console.error('List invoices error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.post('/api/projects/:id/invoices', exports.authMiddleware, async (req, res) => {
    try {
        const uid = req.user.uid;
        const projectId = req.params.id;
        const { invoiceNumber, clientName, amount, status, dueDate, items } = req.body;
        if (!await isProjectMember(projectId, uid)) {
            res.status(403).json({ error: 'Access denied' });
            return;
        }
        if (!invoiceNumber || !amount) {
            res.status(400).json({ error: 'Invoice number and amount are required' });
            return;
        }
        const newInvoice = {
            invoiceNumber,
            clientName: clientName || '',
            amount,
            status: status || 'pending',
            dueDate: dueDate || null,
            items: items || [],
            createdBy: uid,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        const docRef = await db.collection('projects')
            .doc(projectId)
            .collection('invoices')
            .add(newInvoice);
        res.status(201).json(Object.assign(Object.assign({ id: docRef.id }, newInvoice), { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
    }
    catch (error) {
        console.error('Create invoice error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.patch('/api/projects/:projectId/invoices/:invoiceId', exports.authMiddleware, async (req, res) => {
    try {
        const uid = req.user.uid;
        const { projectId, invoiceId } = req.params;
        if (!await isProjectMember(projectId, uid)) {
            res.status(403).json({ error: 'Access denied' });
            return;
        }
        const updates = req.body;
        updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        await db.collection('projects')
            .doc(projectId)
            .collection('invoices')
            .doc(invoiceId)
            .update(updates);
        res.json({ success: true });
    }
    catch (error) {
        console.error('Update invoice error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.delete('/api/projects/:projectId/invoices/:invoiceId', exports.authMiddleware, async (req, res) => {
    try {
        const uid = req.user.uid;
        const { projectId, invoiceId } = req.params;
        if (!await isProjectMember(projectId, uid)) {
            res.status(403).json({ error: 'Access denied' });
            return;
        }
        await db.collection('projects')
            .doc(projectId)
            .collection('invoices')
            .doc(invoiceId)
            .delete();
        res.json({ success: true });
    }
    catch (error) {
        console.error('Delete invoice error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.get('/api/projects/:id/documents', exports.authMiddleware, async (req, res) => {
    try {
        const uid = req.user.uid;
        const projectId = req.params.id;
        if (!await isProjectMember(projectId, uid)) {
            res.status(403).json({ error: 'Access denied' });
            return;
        }
        const documentsSnapshot = await db.collection('projects')
            .doc(projectId)
            .collection('documents')
            .orderBy('uploadedAt', 'desc')
            .get();
        const documents = documentsSnapshot.docs.map((doc) => (Object.assign({ id: doc.id }, doc.data())));
        res.json({ documents });
    }
    catch (error) {
        console.error('List documents error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.post('/api/projects/:id/documents', exports.authMiddleware, async (req, res) => {
    try {
        const uid = req.user.uid;
        const projectId = req.params.id;
        const { name, fileUrl, fileSize, mimeType, version, accessPermissions } = req.body;
        if (!await isProjectMember(projectId, uid)) {
            res.status(403).json({ error: 'Access denied' });
            return;
        }
        if (!name || !fileUrl) {
            res.status(400).json({ error: 'Name and file URL are required' });
            return;
        }
        const newDocument = {
            name,
            fileUrl,
            fileSize: fileSize || 0,
            mimeType: mimeType || 'application/octet-stream',
            version: version || 1,
            accessPermissions: accessPermissions || 'team',
            uploadedBy: uid,
            uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        const docRef = await db.collection('projects')
            .doc(projectId)
            .collection('documents')
            .add(newDocument);
        res.status(201).json(Object.assign(Object.assign({ id: docRef.id }, newDocument), { uploadedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
    }
    catch (error) {
        console.error('Create document error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.patch('/api/projects/:projectId/documents/:documentId', exports.authMiddleware, async (req, res) => {
    try {
        const uid = req.user.uid;
        const { projectId, documentId } = req.params;
        if (!await isProjectMember(projectId, uid)) {
            res.status(403).json({ error: 'Access denied' });
            return;
        }
        const updates = req.body;
        updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        await db.collection('projects')
            .doc(projectId)
            .collection('documents')
            .doc(documentId)
            .update(updates);
        res.json({ success: true });
    }
    catch (error) {
        console.error('Update document error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.delete('/api/projects/:projectId/documents/:documentId', exports.authMiddleware, async (req, res) => {
    var _a;
    try {
        const uid = req.user.uid;
        const { projectId, documentId } = req.params;
        if (!await isProjectMember(projectId, uid)) {
            res.status(403).json({ error: 'Access denied' });
            return;
        }
        const docSnapshot = await db.collection('projects')
            .doc(projectId)
            .collection('documents')
            .doc(documentId)
            .get();
        if (docSnapshot.exists) {
            const fileUrl = (_a = docSnapshot.data()) === null || _a === void 0 ? void 0 : _a.fileUrl;
            if (fileUrl && fileUrl.includes('firebasestorage.googleapis.com')) {
                try {
                    const pathMatch = fileUrl.match(/\/o\/(.+?)\?/);
                    if (pathMatch) {
                        const filePath = decodeURIComponent(pathMatch[1]);
                        await storage.bucket().file(filePath).delete();
                    }
                }
                catch (err) {
                    console.error('Error deleting file from storage:', err);
                }
            }
        }
        await db.collection('projects')
            .doc(projectId)
            .collection('documents')
            .doc(documentId)
            .delete();
        res.json({ success: true });
    }
    catch (error) {
        console.error('Delete document error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.post('/api/projects/:id/documents/upload-url', exports.authMiddleware, async (req, res) => {
    try {
        const uid = req.user.uid;
        const projectId = req.params.id;
        const { fileName, contentType } = req.body;
        if (!await isProjectMember(projectId, uid)) {
            res.status(403).json({ error: 'Access denied' });
            return;
        }
        const bucket = storage.bucket();
        const timestamp = Date.now();
        const filePath = `projects/${projectId}/documents/${timestamp}_${fileName}`;
        const file = bucket.file(filePath);
        const [url] = await file.getSignedUrl({
            version: 'v4',
            action: 'write',
            expires: Date.now() + 15 * 60 * 1000,
            contentType: contentType || 'application/octet-stream',
        });
        res.json({
            uploadUrl: url,
            filePath,
            publicUrl: `https://storage.googleapis.com/${bucket.name}/${filePath}`,
        });
    }
    catch (error) {
        console.error('Generate upload URL error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.get('/api/equipment', exports.authMiddleware, async (req, res) => {
    try {
        const equipmentSnapshot = await db.collection('equipment')
            .orderBy('name', 'asc')
            .get();
        const equipment = equipmentSnapshot.docs.map((doc) => (Object.assign({ id: doc.id }, doc.data())));
        res.json({ equipment });
    }
    catch (error) {
        console.error('List equipment error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.get('/api/equipment/:id', exports.authMiddleware, async (req, res) => {
    try {
        const equipmentDoc = await db.collection('equipment').doc(req.params.id).get();
        if (!equipmentDoc.exists) {
            res.status(404).json({ error: 'Equipment not found' });
            return;
        }
        res.json(Object.assign({ id: equipmentDoc.id }, equipmentDoc.data()));
    }
    catch (error) {
        console.error('Get equipment error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.post('/api/equipment', exports.authMiddleware, async (req, res) => {
    try {
        const { name, category, status, nextMaintenance, purchaseDate, purchasePrice } = req.body;
        if (!name || !category) {
            res.status(400).json({ error: 'Name and category are required' });
            return;
        }
        const newEquipment = {
            name,
            category,
            status: status || 'Available',
            nextMaintenance: nextMaintenance || null,
            purchaseDate: purchaseDate || null,
            purchasePrice: purchasePrice || 0,
            currentProjectId: null,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        const docRef = await db.collection('equipment').add(newEquipment);
        res.status(201).json(Object.assign(Object.assign({ id: docRef.id }, newEquipment), { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
    }
    catch (error) {
        console.error('Add equipment error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.patch('/api/equipment/:id', exports.authMiddleware, async (req, res) => {
    try {
        const updates = req.body;
        updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        await db.collection('equipment').doc(req.params.id).update(updates);
        res.json({ success: true });
    }
    catch (error) {
        console.error('Update equipment error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.delete('/api/equipment/:id', exports.authMiddleware, async (req, res) => {
    try {
        await db.collection('equipment').doc(req.params.id).delete();
        res.json({ success: true });
    }
    catch (error) {
        console.error('Delete equipment error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.get('/api/me', exports.authMiddleware, async (req, res) => {
    try {
        const uid = req.user.uid;
        const userDoc = await db.collection('users').doc(uid).get();
        if (!userDoc.exists) {
            res.status(404).json({ error: 'User profile not found' });
            return;
        }
        res.json(Object.assign({ id: userDoc.id }, userDoc.data()));
    }
    catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.patch('/api/me', exports.authMiddleware, async (req, res) => {
    try {
        const uid = req.user.uid;
        const updates = req.body;
        delete updates.email;
        updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        await db.collection('users').doc(uid).set(updates, { merge: true });
        res.json({ success: true });
    }
    catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.get('/api/users/search', exports.authMiddleware, async (req, res) => {
    try {
        const query = (req.query.q || '').toLowerCase();
        if (!query || query.length < 2) {
            res.status(400).json({ error: 'Query must be at least 2 characters' });
            return;
        }
        const usersSnapshot = await db.collection('users')
            .orderBy('email')
            .limit(20)
            .get();
        const users = usersSnapshot.docs
            .map((doc) => ({
            id: doc.id,
            email: doc.data().email,
            displayName: doc.data().displayName,
            photoURL: doc.data().photoURL,
        }))
            .filter((user) => {
            var _a, _b;
            return ((_a = user.email) === null || _a === void 0 ? void 0 : _a.toLowerCase().includes(query)) ||
                ((_b = user.displayName) === null || _b === void 0 ? void 0 : _b.toLowerCase().includes(query));
        });
        res.json({ users });
    }
    catch (error) {
        console.error('Search users error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        service: 'Production Company Management API',
    });
});
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});
exports.api = (0, https_1.onRequest)(app);
exports.checkOverdueInvoices = (0, scheduler_1.onSchedule)('0 9 * * *', async () => {
    var _a;
    console.log('Checking for overdue invoices...');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const projectsSnapshot = await db.collection('projects').get();
    for (const projectDoc of projectsSnapshot.docs) {
        const invoicesSnapshot = await projectDoc.ref
            .collection('invoices')
            .where('status', '==', 'pending')
            .get();
        const batch = db.batch();
        for (const invoiceDoc of invoicesSnapshot.docs) {
            const dueDate = (_a = invoiceDoc.data().dueDate) === null || _a === void 0 ? void 0 : _a.toDate();
            if (dueDate && dueDate < today) {
                batch.update(invoiceDoc.ref, { status: 'overdue' });
            }
        }
        await batch.commit();
    }
    console.log('Overdue invoice check complete');
});
exports.checkEquipmentMaintenance = (0, scheduler_1.onSchedule)('0 8 * * 1', async () => {
    console.log('Checking equipment maintenance schedules...');
    const oneWeekFromNow = new Date();
    oneWeekFromNow.setDate(oneWeekFromNow.getDate() + 7);
    const equipmentSnapshot = await db.collection('equipment')
        .where('nextMaintenance', '<=', oneWeekFromNow)
        .where('status', '!=', 'Maintenance')
        .get();
    console.log(`Found ${equipmentSnapshot.size} items needing maintenance soon`);
    for (const doc of equipmentSnapshot.docs) {
        const data = doc.data();
        console.log(`Maintenance due for: ${data.name} on ${data.nextMaintenance}`);
    }
});
//# sourceMappingURL=index.js.map