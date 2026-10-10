'use client';

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { useNavigationStore } from '@/stores/navigationStore';
import { useModuleEnabled, MODULE_CODES } from '@/hooks/useModuleEnabled';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { ResponsiveDialog } from '@/components/shared/ResponsiveDialog';;
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Package, Wrench, ArrowRightLeft, Clock, CheckCircle2, XCircle,
  AlertTriangle, TrendingUp, FileText, MoreHorizontal, Plus,
  Search, Filter, Eye, RotateCcw, Send, ShieldCheck, Warehouse,
  Timer, Activity, Ban, ClipboardList, BarChart3,
  ArrowLeftRight, PackageCheck, PackageOpen, User, CircleDot,
  Handshake, Truck, DollarSign, RefreshCw, X, Info, Pencil, Trash2,
  FileDown, Loader2,
} from 'lucide-react';
import { EmptyState, LoadingSkeleton, formatCurrency, formatDuration, formatDurationFromMinutes } from '@/components/shared/helpers';
import { DateTimePicker, DateRangePicker } from '@/components/ui/datetime-picker';
import { AsyncSearchableSelect } from '@/components/ui/searchable-select';
import {
  canCompleteSpareRefurbishment as canCompleteSpareRefurbishmentPolicy,
  canDisposeSparePartReturn as canDisposeSparePartReturnPolicy,
  canInspectSparePartReturn as canInspectSparePartReturnPolicy,
  canReturnSparePartToStore as canReturnSparePartToStorePolicy,
  canStartSpareRefurbishment as canStartSpareRefurbishmentPolicy,
} from '@/lib/spare-part-return-authorization';

// ============================================================================
// SHARED HELPERS
// ============================================================================

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  supervisor_approved: 'bg-blue-100 text-blue-800',
  storekeeper_approved: 'bg-indigo-100 text-indigo-800',
  store_approved: 'bg-indigo-100 text-indigo-800',
  picking: 'bg-violet-100 text-violet-800',
  issued: 'bg-green-100 text-green-800',
  partially_returned: 'bg-teal-100 text-teal-800',
  fully_returned: 'bg-gray-100 text-gray-800',
  returned: 'bg-gray-100 text-gray-800',
  pending_return: 'bg-amber-100 text-amber-800',
  rejected: 'bg-red-100 text-red-800',
  transferred: 'bg-emerald-100 text-emerald-800',
  pending_review: 'bg-orange-100 text-orange-800',
  approved: 'bg-green-100 text-green-800',
  rework_requested: 'bg-red-100 text-red-800',
  pending_closure: 'bg-blue-100 text-blue-800',
  closed: 'bg-gray-100 text-gray-700',
  planned: 'bg-purple-100 text-purple-800',
  unplanned: 'bg-red-100 text-red-800',
};

function StatusBadge({ status }: { status: string }) {
  const label = status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return <Badge variant="outline" className={statusColors[status] || 'bg-gray-100 text-gray-800'}>{label}</Badge>;
}

function PriorityBadge({ priority }: { priority: string }) {
  const colors: Record<string, string> = { low: 'bg-slate-100 text-slate-700', medium: 'bg-blue-100 text-blue-700', high: 'bg-orange-100 text-orange-700', critical: 'bg-red-100 text-red-700' };
  return <Badge variant="outline" className={colors[priority] || 'bg-gray-100'}>{priority?.toUpperCase()}</Badge>;
}

// ============================================================================
// SHARED SUB-COMPONENTS
// ============================================================================

const URGENCY_CONFIG: Record<string, { label: string; color: string; dotColor: string }> = {
  low: { label: 'Low', color: 'bg-slate-100 text-slate-700 border-slate-300', dotColor: 'bg-slate-400' },
  medium: { label: 'Medium', color: 'bg-amber-50 text-amber-700 border-amber-300', dotColor: 'bg-amber-500' },
  high: { label: 'High', color: 'bg-orange-50 text-orange-700 border-orange-300', dotColor: 'bg-orange-500' },
  critical: { label: 'Critical', color: 'bg-red-50 text-red-700 border-red-300', dotColor: 'bg-red-500' },
};

function UrgencyBadge({ urgency }: { urgency: string }) {
  const cfg = URGENCY_CONFIG[urgency];
  if (!cfg) return null;
  return (
    <Badge variant="outline" className={`${cfg.color} gap-1.5 text-xs font-medium`}>
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dotColor}`} />
      {cfg.label}
    </Badge>
  );
}

type PipelineStage = { key: string; label: string; icon: React.ElementType };

function MiniPipeline({ stages, currentStatus, rejected }: { stages: PipelineStage[]; currentStatus: string; rejected?: boolean }) {
  const currentIndex = stages.findIndex(s => s.key === currentStatus);
  if (rejected) {
    return (
      <div className="flex items-center gap-0.5">
        {stages.map((s, i) => (
          <TooltipProvider key={s.key} delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className={`h-2 w-2 rounded-full ${i === currentIndex ? 'bg-red-500' : i < currentIndex ? 'bg-emerald-400' : 'bg-gray-200'}`} />
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">{s.label}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ))}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-0.5">
      {stages.map((s, i) => (
        <TooltipProvider key={s.key} delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className={`h-2 w-2 rounded-full transition-colors ${i <= currentIndex ? 'bg-teal-500' : 'bg-gray-200'}`} />
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">{s.label}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ))}
    </div>
  );
}

function AvatarPlaceholder({ name, size = 'sm' }: { name: string; size?: 'sm' | 'md' }) {
  const initials = name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || '??';
  const sz = size === 'sm' ? 'h-7 w-7 text-xs' : 'h-9 w-9 text-sm';
  return (
    <div className={`${sz} rounded-full bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center text-white font-semibold flex-shrink-0`}>
      {initials}
    </div>
  );
}

function OverduePulse({ isOverdue, date }: { isOverdue: boolean; date: string }) {
  const timeAgo = formatDistanceToNow(new Date(date), { addSuffix: true });
  return (
    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
      {isOverdue && <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" /></span>}
      {timeAgo}
    </div>
  );
}

function StatsCard({ icon: Icon, count, label, color, bgColor, subtext, onClick }: {
  icon: React.ElementType; count: number | string; label: string;
  color: string; bgColor: string; subtext?: string; onClick?: () => void;
}) {
  return (
    <Card className={`group hover:shadow-md transition-all ${onClick ? 'cursor-pointer active:scale-[0.98]' : ''}`} onClick={onClick}>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className={`${bgColor} p-2.5 rounded-lg`}>
            <Icon className={`h-5 w-5 ${color}`} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-2xl font-bold tracking-tight">{count}</p>
            <p className="text-xs text-muted-foreground truncate">{label}</p>
          </div>
          {subtext && <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{subtext}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function ClearFiltersButton({ onClick, count }: { onClick: () => void; count: number }) {
  if (count === 0) return null;
  return (
    <Button variant="ghost" size="sm" onClick={onClick} className="h-9 text-muted-foreground hover:text-foreground gap-1.5">
      <X className="h-3.5 w-3.5" /> Clear <Badge variant="secondary" className="h-5 min-w-5 px-1 text-[10px]">{count}</Badge>
    </Button>
  );
}

function RejectDialog({ open, onClose, onConfirm, title }: {
  open: boolean; onClose: () => void; onConfirm: (reason: string) => void; title: string;
}) {
  const [reason, setReason] = useState('');
  useEffect(() => { if (!open) setReason(''); }, [open]);
  return (
    <ResponsiveDialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      
        <div className="space-y-1.5 mb-4"><h2 className="text-lg font-semibold leading-none tracking-tight">{title}</h2><p className="text-sm text-muted-foreground">Please provide a reason (minimum 10 characters).</p></div>
        <Textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason for rejection..." rows={3} />
        {reason.length > 0 && reason.length < 10 && <p className="text-xs text-amber-600">{10 - reason.length} more characters needed</p>}
        <div className="flex flex-col-reverse gap-2 mt-4 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" disabled={reason.trim().length < 10} onClick={() => { onConfirm(reason); onClose(); }}>Reject</Button>
        </div>
      
    </ResponsiveDialog>
  );
}

function QuantityDialog({ open, onClose, onConfirm, title, description, max, fieldLabel }: {
  open: boolean; onClose: () => void; onConfirm: (qty: number, condition: string) => void;
  title: string; description: string; max: number; fieldLabel: string;
}) {
  const [value, setValue] = useState('');
  const [condition, setCondition] = useState('');
  useEffect(() => { if (!open) { setValue(''); setCondition(''); } }, [open]);
  const q = parseFloat(value);
  const valid = !isNaN(q) && q > 0 && q <= max && !!condition;
  return (
    <ResponsiveDialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      
        <div className="space-y-1.5 mb-4"><h2 className="text-lg font-semibold leading-none tracking-tight">{title}</h2><p className="text-sm text-muted-foreground">{description}</p></div>
        <div className="space-y-2">
          <Label>{fieldLabel}</Label>
          <Input type="number" value={value} onChange={e => setValue(e.target.value)} placeholder="Enter quantity" min={1} max={max} />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Max available: {max}</span>
            {!isNaN(q) && q > 0 && q <= max && <span className="text-emerald-600 font-medium">Quantity valid</span>}
          </div>
          <div className="space-y-2 pt-2">
            <Label>Return condition *</Label>
            <Select value={condition} onValueChange={setCondition}>
              <SelectTrigger><SelectValue placeholder="Select physical condition" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="serviceable">Serviceable — return to usable stock</SelectItem>
                <SelectItem value="damaged">Damaged — quarantine for inspection / repair</SelectItem>
                <SelectItem value="defective">Defective — quarantine for inspection / repair</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex flex-col-reverse gap-2 mt-4 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" disabled={!valid} onClick={() => { onConfirm(q, condition); onClose(); }}>Confirm</Button>
        </div>
      
    </ResponsiveDialog>
  );
}

function ConditionSelectDialog({ open, onClose, onConfirm }: {
  open: boolean; onClose: () => void; onConfirm: (condition: string) => void;
}) {
  const [condition, setCondition] = useState('good');
  const options = [
    { value: 'new', label: 'New/Excellent', color: 'bg-emerald-100 text-emerald-800' },
    { value: 'good', label: 'Good', color: 'bg-teal-100 text-teal-800' },
    { value: 'fair', label: 'Fair', color: 'bg-amber-100 text-amber-800' },
    { value: 'poor', label: 'Poor', color: 'bg-orange-100 text-orange-800' },
    { value: 'damaged', label: 'Damaged', color: 'bg-red-100 text-red-800' },
  ];
  return (
    <ResponsiveDialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      
        <div className="space-y-1.5 mb-4"><h2 className="text-lg font-semibold leading-none tracking-tight">Select Tool Condition</h2><p className="text-sm text-muted-foreground">Assess the current condition of the tool.</p></div>
        <div className="grid grid-cols-2 gap-2">
          {options.map(o => (
            <button key={o.value} onClick={() => setCondition(o.value)}
              className={`p-3 rounded-lg border-2 text-left transition-all ${condition === o.value ? 'border-teal-500 ring-2 ring-teal-200' : 'border-gray-200 hover:border-gray-300'}`}>
              <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${o.color} mb-1`}>{o.label}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-col-reverse gap-2 mt-4 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => { onConfirm(condition); onClose(); }}>Confirm</Button>
        </div>
      
    </ResponsiveDialog>
  );
}

function DetailTimeline({ events }: { events: Array<{ label: string; date?: string; user?: string; notes?: string; status?: string }> }) {
  return (
    <div className="space-y-0">
      {events.map((ev, i) => (
        <div key={i} className="flex gap-3">
          <div className="flex flex-col items-center">
            <div className={`h-3 w-3 rounded-full border-2 ${ev.status === 'rejected' ? 'bg-red-400 border-red-300' : ev.date ? 'bg-teal-500 border-teal-300' : 'bg-gray-200 border-gray-300'}`} />
            {i < events.length - 1 && <div className="w-0.5 flex-1 bg-gray-200 my-1" />}
          </div>
          <div className="pb-4 min-w-0">
            <p className="text-sm font-medium">{ev.label}</p>
            {ev.date && <p className="text-xs text-muted-foreground">{format(new Date(ev.date), 'MMM d, yyyy h:mm a')}</p>}
            {ev.user && <p className="text-xs text-muted-foreground">by {ev.user}</p>}
            {ev.notes && <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1 mt-1">{ev.notes}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// MATERIAL REQUEST PIPELINE CONFIG
// ============================================================================

const MATERIAL_STAGES: PipelineStage[] = [
  { key: 'pending', label: 'Pending', icon: Clock },
  { key: 'supervisor_approved', label: 'Supervisor Review', icon: ShieldCheck },
  { key: 'storekeeper_approved', label: 'Store Review', icon: Warehouse },
  { key: 'picking', label: 'Picking', icon: PackageOpen },
  { key: 'issued', label: 'Issued', icon: PackageCheck },
  { key: 'closed', label: 'Reconciled', icon: ClipboardList },
];

const TOOL_STAGES: PipelineStage[] = [
  { key: 'pending', label: 'Pending', icon: Clock },
  { key: 'supervisor_approved', label: 'Supervisor Review', icon: ShieldCheck },
  { key: 'storekeeper_approved', label: 'Store Review', icon: Warehouse },
  { key: 'issued', label: 'Issued', icon: Wrench },
  { key: 'returned', label: 'Returned', icon: RotateCcw },
];

const TRANSFER_STAGES: PipelineStage[] = [
  { key: 'pending', label: 'Pending', icon: Clock },
  { key: 'storekeeper_approved', label: 'Storekeeper Review', icon: ShieldCheck },
  { key: 'awaiting_handover', label: 'Handover', icon: Handshake },
  { key: 'transferred', label: 'Transferred', icon: ArrowRightLeft },
];

// ============================================================================
// SHARED PERMISSION HELPERS
// ============================================================================

function canApproveAsSupervisor(
  request: any,
  user: any,
  requiredPermission?: string,
): boolean {
  if (!user || !request?.workOrder) return false;
  const { isAdmin, user: authUser, hasPermission } = useAuthStore.getState();
  if (isAdmin()) return true;
  if (requiredPermission && !hasPermission(requiredPermission)) return false;
  const userId = authUser?.id || user?.id;
  const roles = (authUser?.roles || user?.roles || []).map((r: any) => r.slug).filter(Boolean);
  if (roles.includes('maintenance_manager') || roles.includes('plant_manager')) return true;
  return roles.includes('maintenance_supervisor')
    && Boolean(request.workOrder.assignedSupervisorId)
    && request.workOrder.assignedSupervisorId === userId;
}

function roleSlugsFor(user: any): string[] {
  const authUser = useAuthStore.getState().user;
  const actor = authUser || user;
  return (actor?.roles || [])
    .map((role: any) => typeof role === 'string' ? role : role?.slug)
    .filter(Boolean);
}

function sparePartReturnActor(user: any) {
  const authUser = useAuthStore.getState().user;
  const actor = authUser || user;
  return { userId: actor?.id, roles: roleSlugsFor(user) };
}

function canApproveAsStore(user: any, requiredPermission?: string): boolean {
  if (!user) return false;
  const { isAdmin, hasPermission } = useAuthStore.getState();
  // Keep physical store custody actions aligned with server authorization.
  if (isAdmin()) return true;
  if (requiredPermission && !hasPermission(requiredPermission)) return false;
  const storeRoles = ['admin', 'inventory_manager', 'store_keeper', 'tools_shop_attendant'];
  return roleSlugsFor(user).some((slug: string) => storeRoles.includes(slug));
}

function canInspectSparePartReturn(user: any): boolean {
  return Boolean(user) && canInspectSparePartReturnPolicy(sparePartReturnActor(user));
}

function canStartSpareRefurbishment(user: any): boolean {
  return Boolean(user) && canStartSpareRefurbishmentPolicy(sparePartReturnActor(user));
}

function canCompleteSpareRefurbishment(record: any, user: any): boolean {
  return Boolean(user && record) && canCompleteSpareRefurbishmentPolicy(sparePartReturnActor(user), record);
}

function canReturnSparePartToStore(user: any): boolean {
  return Boolean(user) && canReturnSparePartToStorePolicy(sparePartReturnActor(user));
}

function canDisposeSparePartReturn(user: any): boolean {
  return Boolean(user) && canDisposeSparePartReturnPolicy(sparePartReturnActor(user));
}

function canActAsToolCustodian(request: any, user: any): boolean {
  if (!user || !request) return false;
  const { isAdmin, user: authUser } = useAuthStore.getState();
  if (isAdmin()) return true;
  const userId = authUser?.id || user?.id;
  return Boolean(userId) && request.requestedById === userId;
}

function canTransferToolCustody(request: any, user: any): boolean {
  if (!canActAsToolCustodian(request, user)) return false;
  const { hasPermission, isAdmin } = useAuthStore.getState();
  return isAdmin() || hasPermission('repair_tool_transfers.create');
}

function canDeclareMaterialUsage(request: any, user: any): boolean {
  if (!user || !request?.workOrder) return false;
  const { isAdmin, user: authUser } = useAuthStore.getState();
  if (isAdmin()) return true;
  const userId = authUser?.id || user?.id;
  if (!userId) return false;
  return request.workOrder.assignedTo === userId
    || request.workOrder.teamLeaderId === userId
    || (request.workOrder.teamMembers || []).some((member: any) => member.userId === userId);
}

function getActorContext(user: any) {
  const { isAdmin, user: authUser } = useAuthStore.getState();
  const actor = authUser || user;
  return {
    isAdmin: isAdmin(),
    userId: actor?.id as string | undefined,
    roles: (actor?.roles || []).map((r: any) => r.slug).filter(Boolean) as string[],
  };
}

function canSubmitCompletion(completion: any, user: any): boolean {
  if (!completion?.workOrder || !user) return false;
  const { isAdmin, userId, roles } = getActorContext(user);
  if (isAdmin || roles.includes('maintenance_manager')) return true;
  if (!userId) return false;

  const wo = completion.workOrder;
  const teamMembers = wo.teamMembers || [];
  const distinctSupportingTechs = new Set(
    teamMembers.map((member: any) => member.userId).filter((id: string) => id && id !== wo.assignedTo),
  ).size;
  const isMultiTech = distinctSupportingTechs >= 2;
  const isAssignee = wo.assignedTo === userId || wo.assignee?.id === userId;
  const isTeamLeader = wo.teamLeaderId === userId
    || teamMembers.some((member: any) => member.userId === userId && member.role === 'team_leader');

  return isMultiTech ? isTeamLeader : isAssignee;
}

function canReviewCompletion(completion: any, user: any): boolean {
  if (!completion?.workOrder || !user) return false;
  const { isAdmin, userId, roles } = getActorContext(user);
  if (isAdmin) return true;

  const { hasPermission } = useAuthStore.getState();
  if (!hasPermission('work_orders.verify')) return false;
  if (roles.includes('maintenance_manager')) return true;

  return Boolean(userId)
    && roles.includes('maintenance_supervisor')
    && completion.workOrder.assignedSupervisorId === userId;
}

function canCloseCompletion(completion: any, user: any): boolean {
  if (!completion?.workOrder || !user) return false;
  const { isAdmin, userId, roles } = getActorContext(user);
  if (isAdmin) return true;

  const { hasPermission } = useAuthStore.getState();
  if (!hasPermission('work_orders.close')) return false;
  if (roles.includes('maintenance_manager')) return true;

  return Boolean(userId)
    && roles.includes('maintenance_planner')
    && completion.workOrder.plannerId === userId;
}

function canViewAllRepairData(user: any, domainPermissions: string[]): boolean {
  if (!user) return false;
  const { hasPermission, isAdmin } = useAuthStore.getState();
  return isAdmin() || domainPermissions.some((permission) => hasPermission(permission));
}

// ============================================================================
// PAGE 1: REPAIR MATERIAL REQUESTS
// ============================================================================

export function RepairMaterialRequestsPage() {
  const { user, hasPermission, isAdmin } = useAuthStore();
  const { pageParams } = useNavigationStore();
  const repairsEnabled = useModuleEnabled(MODULE_CODES.REPAIRS);
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any>(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterUrgency, setFilterUrgency] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [detailItem, setDetailItem] = useState<any>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<{ id: string; action: string } | null>(null);
  const [qtyOpen, setQtyOpen] = useState(false);
  const [qtyTarget, setQtyTarget] = useState<{ id: string; action: string; max: number; field: string } | null>(null);
  const [workOrderIdFilter, setWorkOrderIdFilter] = useState('');
  const [pagination, setPagination] = useState<{ page: number; totalPages: number; total: number } | null>(null);
  const [createForm, setCreateForm] = useState({ workOrderId: '', itemName: '', itemId: '', componentRegistryId: '', quantityRequested: '', unit: 'each', unitCost: '', reason: '', notes: '', urgency: 'medium' });
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [reconcileTarget, setReconcileTarget] = useState<any>(null);
  const [reconcileForm, setReconcileForm] = useState({ consumedQty: '', wastedQty: '', returnCondition: '', notes: '' });
  const [usageDeclarationOpen, setUsageDeclarationOpen] = useState(false);
  const [usageDeclarationTarget, setUsageDeclarationTarget] = useState<any>(null);
  const [usageDeclarationForm, setUsageDeclarationForm] = useState({ consumedQty: '', wastedQty: '0', returnQty: '', notes: '' });
  const [viewMode, setViewMode] = useState<'all' | 'mine'>('all');

  const canViewAll = canViewAllRepairData(user, ['repair_material_requests.view', 'repair_material_requests.view_all']);
  // Auto-switch to 'mine' if user doesn't have view_all permission
  useEffect(() => {
    if (!canViewAll && viewMode === 'all') setViewMode('mine');
  }, [canViewAll]);

  useEffect(() => {
    if (pageParams?.workOrderId) {
      setWorkOrderIdFilter(pageParams.workOrderId);
    }
  }, []);

  const activeFilters = useMemo(() => {
    let c = 0;
    if (filterStatus !== 'all') c++;
    if (filterUrgency !== 'all') c++;
    if (searchText) c++;
    return c;
  }, [filterStatus, filterUrgency, searchText]);

  const clearFilters = () => { setFilterStatus('all'); setFilterUrgency('all'); setSearchText(''); setPage(1); setWorkOrderIdFilter(''); };

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterStatus !== 'all') params.set('status', filterStatus);
    if (filterUrgency !== 'all') params.set('urgency', filterUrgency);
    if (workOrderIdFilter) params.set('workOrderId', workOrderIdFilter);
    params.set('page', String(page));
    params.set('limit', '20');
    const [listRes, statsRes] = await Promise.all([
      api.get(`/api/repairs/material-requests?${params}`),
      api.get('/api/repairs/material-requests?stats=true'),
    ]);
    if (listRes.success) {
      setRequests(listRes.data || []);
      if (listRes.pagination) setPagination(listRes.pagination);
    } else {
      toast.error(listRes.error || 'Failed to load');
    }
    if (statsRes.success) setStats(statsRes.data);
    setLoading(false);
  }, [filterStatus, filterUrgency, page, workOrderIdFilter]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  const handleCreate = async () => {
    if (!createForm.workOrderId || !createForm.itemName || !createForm.quantityRequested || !createForm.reason || createForm.reason.length < 5) {
      toast.error('Work Order, Item Name, Quantity, and Reason (min 5 chars) are required');
      return;
    }
    setSubmitting(true);
    const res = await api.post('/api/repairs/material-requests', {
      workOrderId: createForm.workOrderId, itemId: createForm.itemId || undefined,
      componentRegistryId: createForm.componentRegistryId || undefined,
      itemName: createForm.itemName, quantityRequested: parseFloat(createForm.quantityRequested),
      unit: createForm.unit, unitCost: createForm.unitCost ? parseFloat(createForm.unitCost) : undefined,
      reason: createForm.reason, notes: createForm.notes || undefined, urgency: createForm.urgency,
    });
    if (res.success) {
      toast.success('Material request created'); setCreateOpen(false);
      setCreateForm({ workOrderId: '', itemName: '', itemId: '', componentRegistryId: '', quantityRequested: '', unit: 'each', unitCost: '', reason: '', notes: '', urgency: 'medium' });
      fetchRequests();
    } else toast.error(res.error || 'Failed');
    setSubmitting(false);
  };

  const handleAction = async (id: string, action: string, extra?: Record<string, any>) => {
    setSubmitting(true);
    const res = await api.post(`/api/repairs/material-requests/${id}`, { action, ...extra });
    if (res.success) { toast.success('Action completed'); fetchRequests(); if (detailOpen && detailItem?.id === id) setDetailOpen(false); }
    else toast.error(res.error || 'Failed');
    setSubmitting(false);
  };

  const handleDelete = async (id: string) => {
    setSubmitting(true);
    const res = await api.delete(`/api/repairs/material-requests/${id}`);
    if (res.success) { toast.success('Request cancelled'); fetchRequests(); } else toast.error(res.error || 'Failed');
    setSubmitting(false);
  };

  const handlePick = async (id: string) => {
    setSubmitting(true);
    const res = await api.post('/api/repairs/material-requests/pick', { id });
    if (res.success) { toast.success('Items being picked'); fetchRequests(); if (detailOpen && detailItem?.id === id) setDetailOpen(false); }
    else toast.error(res.error || 'Failed to pick');
    setSubmitting(false);
  };

  const openUsageDeclaration = (target: any) => {
    const issued = Number(target?.quantityIssued || 0);
    const declaredConsumed = target?.declaredConsumedQty ?? target?.consumedQty;
    const declaredWasted = target?.declaredWastedQty ?? target?.wastedQty ?? 0;
    const hasExistingDeclaration = target?.declaredConsumedQty != null || target?.declaredReturnQty != null || target?.consumedQty != null;
    const declaredReturn = target?.declaredReturnQty ?? (hasExistingDeclaration ? Math.max(0, issued - Number(declaredConsumed || 0) - Number(declaredWasted || 0)) : '');
    setUsageDeclarationTarget(target);
    setUsageDeclarationForm({
      consumedQty: declaredConsumed == null ? '' : String(declaredConsumed),
      wastedQty: String(declaredWasted || 0),
      returnQty: declaredReturn === '' ? '' : String(declaredReturn),
      notes: target?.usageDeclarationNotes || '',
    });
    setUsageDeclarationOpen(true);
  };

  const handleUsageDeclaration = async () => {
    if (!usageDeclarationTarget) return;
    const consumed = Number(usageDeclarationForm.consumedQty);
    const wasted = Number(usageDeclarationForm.wastedQty || 0);
    const toReturn = Number(usageDeclarationForm.returnQty);
    const issued = Number(usageDeclarationTarget.quantityIssued || 0);
    if (!Number.isFinite(consumed) || consumed < 0) { toast.error('Enter a valid used quantity'); return; }
    if (!Number.isFinite(wasted) || wasted < 0) { toast.error('Enter a valid wasted/damaged quantity'); return; }
    if (!Number.isFinite(toReturn) || toReturn < 0) { toast.error('Enter a valid quantity to return'); return; }
    const accounted = consumed + wasted + toReturn;
    if (Math.abs(accounted - issued) > 0.001) {
      toast.error(`Used + wasted + to return must equal issued quantity (${issued}). Current total: ${accounted}`);
      return;
    }
    setSubmitting(true);
    const res = await api.post(`/api/repairs/material-requests/${usageDeclarationTarget.id}`, {
      action: 'declare_usage',
      consumedQty: consumed,
      wastedQty: wasted,
      returnQty: toReturn,
      notes: usageDeclarationForm.notes || undefined,
    });
    if (res.success) {
      toast.success('Usage declaration submitted — awaiting store verification');
      setUsageDeclarationOpen(false);
      setUsageDeclarationTarget(null);
      setUsageDeclarationForm({ consumedQty: '', wastedQty: '0', returnQty: '', notes: '' });
      fetchRequests();
      if (detailOpen) setDetailOpen(false);
    } else {
      toast.error(res.error || 'Failed to submit usage declaration');
    }
    setSubmitting(false);
  };

  const openStoreReconcile = (target: any) => {
    setReconcileTarget(target);
    setReconcileForm({
      consumedQty: String(target?.declaredConsumedQty ?? target?.consumedQty ?? ''),
      wastedQty: String(target?.declaredWastedQty ?? target?.wastedQty ?? 0),
      returnCondition: '',
      notes: target?.usageDeclarationNotes || '',
    });
    setReconcileOpen(true);
  };

  const handleReconcile = async () => {
    if (!reconcileTarget) return;
    const consumed = parseFloat(reconcileForm.consumedQty);
    const wasted = parseFloat(reconcileForm.wastedQty) || 0;
    if (isNaN(consumed) || consumed < 0) { toast.error('Enter a valid consumed quantity'); return; }
    if (isNaN(wasted) || wasted < 0) { toast.error('Enter a valid wasted quantity'); return; }
    if (consumed + wasted > reconcileTarget.quantityIssued) {
      toast.error(`Consumed + wasted (${consumed + wasted}) cannot exceed issued (${reconcileTarget.quantityIssued})`);
      return;
    }
    const targetReturned = Math.max(0, Number(reconcileTarget.quantityIssued || 0) - consumed - wasted);
    const additionalReturn = Math.max(0, targetReturned - Number(reconcileTarget.quantityReturned || 0));
    if (additionalReturn > 0.001 && !reconcileForm.returnCondition) {
      toast.error('Select the physical condition of the material being returned');
      return;
    }
    setSubmitting(true);
    const res = await api.post('/api/repairs/material-requests/reconcile', {
      id: reconcileTarget.id,
      consumedQty: consumed,
      wastedQty: wasted > 0 ? wasted : undefined,
      returnCondition: reconcileForm.returnCondition || undefined,
      notes: reconcileForm.notes || undefined,
    });
    if (res.success) {
      toast.success(res.data?.reconciliation
        ? `Reconciled: ${res.data.reconciliation.consumedQty} consumed, ${res.data.reconciliation.wastedQty} wasted, ${res.data.reconciliation.returnedQty} returned`
        : 'Reconciliation completed');
      setReconcileOpen(false);
      setReconcileTarget(null);
      setReconcileForm({ consumedQty: '', wastedQty: '', returnCondition: '', notes: '' });
      fetchRequests();
      if (detailOpen) setDetailOpen(false);
    } else toast.error(res.error || 'Failed to reconcile');
    setSubmitting(false);
  };

  const filtered = useMemo(() => requests.filter(r =>
    !searchText || r.itemName?.toLowerCase().includes(searchText.toLowerCase()) || r.workOrder?.woNumber?.toLowerCase().includes(searchText.toLowerCase())
  ), [requests, searchText]);

  // Cache for inventory item lookup (used by AsyncSearchableSelect)
  const inventoryItemsCache = useRef<any[]>([]);
  const fetchInventoryItems = useCallback(async () => {
    const res = await api.get('/api/inventory?mode=lookup&limit=500');
    if (res.success && Array.isArray(res.data)) {
      inventoryItemsCache.current = res.data;
      return res.data.map((i: any) => ({ value: i.id, label: i.name + (i.itemCode ? ` (${i.itemCode})` : '') }));
    }
    return [];
  }, []);

  const estimatedCost = useMemo(() => {
    const qty = parseFloat(createForm.quantityRequested) || 0;
    const cost = parseFloat(createForm.unitCost) || 0;
    return qty * cost;
  }, [createForm.quantityRequested, createForm.unitCost]);

  if (!repairsEnabled) {
    return (<div className="flex items-center justify-center h-96"><div className="text-center"><p className="text-muted-foreground">Repairs module is not active.</p><p className="text-sm text-muted-foreground mt-1">Enable it in Settings → Modules.</p></div></div>);
  }

  return (
    <div className="page-content">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-100 rounded-xl"><Package className="h-6 w-6 text-amber-700" /></div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold tracking-tight">Material Requests</h2>
              <Badge variant="secondary" className="font-mono">{requests.length}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">Request and track materials &amp; spare parts for repair work orders</p>
          </div>
        </div>
        {(user && (hasPermission('repair_material_requests.create') || isAdmin())) && <Button onClick={() => setCreateOpen(true)} className="gap-2"><Plus className="h-4 w-4" /> New Request</Button>}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatsCard icon={Clock} count={stats?.byStatus?.pending ?? requests.filter(r => r.status === 'pending').length} label="Pending" color="text-yellow-600" bgColor="bg-yellow-50" onClick={() => { setFilterStatus('pending'); setPage(1); }} />
        <StatsCard icon={ShieldCheck} count={((stats?.byStatus?.supervisor_approved || 0) + (stats?.byStatus?.storekeeper_approved || 0)) || requests.filter(r => ['supervisor_approved', 'storekeeper_approved'].includes(r.status)).length} label="Awaiting Approval" color="text-sky-600" bgColor="bg-sky-50" onClick={() => { setFilterStatus('supervisor_approved'); setPage(1); }} />
        <StatsCard icon={PackageCheck} count={stats?.byStatus?.issued ?? requests.filter(r => r.status === 'issued').length} label="Issued" color="text-emerald-600" bgColor="bg-emerald-50" onClick={() => { setFilterStatus('issued'); setPage(1); }} />
        <StatsCard icon={AlertTriangle} count={stats?.overdueCount ?? requests.filter(r => r.isOverdue).length} label="Overdue" color="text-red-600" bgColor="bg-red-50" subtext="!" onClick={() => { setFilterStatus('all'); setPage(1); }} />
        <StatsCard icon={DollarSign} count={formatCurrency(stats?.totalCost || 0)} label="Total Cost" color="text-teal-600" bgColor="bg-teal-50" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search items or WO#..." value={searchText} onChange={(e) => setSearchText(e.target.value)} className="pl-9" />
        </div>
        <Select value={filterStatus} onValueChange={(v) => { setFilterStatus(v); setPage(1); }}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="supervisor_approved">Supervisor Approved</SelectItem>
            <SelectItem value="storekeeper_approved">Store Approved</SelectItem>
            <SelectItem value="picking">Picking</SelectItem>
            <SelectItem value="issued">Issued</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterUrgency} onValueChange={(v) => { setFilterUrgency(v); setPage(1); }}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Urgency" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Urgency</SelectItem>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
          </SelectContent>
        </Select>
        {canViewAll && (
          <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
            <Button size="sm" variant={viewMode === 'all' ? 'default' : 'ghost'} className={`gap-1 h-8 ${viewMode === 'all' ? 'bg-background shadow-sm' : ''}`} onClick={() => setViewMode('all')}>
              <ClipboardList className="h-3 w-3" /> All Requests
            </Button>
            <Button size="sm" variant={viewMode === 'mine' ? 'default' : 'ghost'} className={`gap-1 h-8 ${viewMode === 'mine' ? 'bg-background shadow-sm' : ''}`} onClick={() => setViewMode('mine')}>
              <User className="h-3 w-3" /> My Requests
            </Button>
          </div>
        )}
        <ClearFiltersButton onClick={clearFilters} count={activeFilters} />
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {loading ? <LoadingSkeleton /> : filtered.length === 0 ? (
            <EmptyState icon={Package} title="No material requests found" description="Create a new request to get started">
              {(user && (hasPermission('repair_material_requests.create') || isAdmin())) && <Button onClick={() => setCreateOpen(true)} className="gap-2"><Plus className="h-4 w-4" /> New Request</Button>}
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="w-[220px]">Item</TableHead>
                    <TableHead className="w-[90px]">WO #</TableHead>
                    <TableHead className="w-[60px]">Urgency</TableHead>
                    <TableHead className="w-[120px]">Quantity</TableHead>
                    <TableHead className="w-[180px]">Status</TableHead>
                    <TableHead className="w-[130px]">Requested By</TableHead>
                    <TableHead className="w-[110px]">Time</TableHead>
                    <TableHead className="w-[140px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r, idx) => (
                    <TableRow key={r.id} className={`cursor-pointer hover:bg-muted/30 transition-colors ${idx % 2 === 0 ? '' : 'bg-muted/20'}`}
                      onClick={() => { setDetailItem(r); setDetailOpen(true); }}>
                      <TableCell>
                        <div className="font-medium text-sm">{r.itemName}</div>
                        {r.componentRegistry && <div className="text-[11px] text-muted-foreground font-mono">{r.componentRegistry.componentCode || r.componentRegistry.name}</div>}
                        <div className="text-xs text-muted-foreground">{r.unit} · {formatCurrency(r.unitCost || 0)}/unit</div>
                      </TableCell>
                      <TableCell><Badge variant="outline" className="font-mono text-xs">{r.workOrder?.woNumber}</Badge></TableCell>
                      <TableCell>{r.urgency && <UrgencyBadge urgency={r.urgency} />}</TableCell>
                      <TableCell>
                        <div className="font-medium text-sm">{r.quantityRequested}</div>
                        <div className="text-[11px] text-muted-foreground">App: {r.quantityApproved ?? '—'} · Iss: {r.quantityIssued ?? '—'} · Ret: {r.quantityReturned ?? '—'}</div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <StatusBadge status={r.status} />
                          <MiniPipeline stages={MATERIAL_STAGES} currentStatus={r.status} rejected={r.status === 'rejected'} />
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <AvatarPlaceholder name={r.requestedBy?.fullName || ''} />
                          <span className="text-sm truncate max-w-[80px]">{r.requestedBy?.fullName}</span>
                        </div>
                      </TableCell>
                      <TableCell><OverduePulse isOverdue={r.isOverdue} date={r.createdAt} /></TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                          {r.status === 'pending' && canApproveAsSupervisor(r, user, 'repair_material_requests.update') && (
                            <>
                              <TooltipProvider><Tooltip><TooltipTrigger asChild><Button size="sm" variant="ghost" className="h-7 px-2 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50" onClick={() => handleAction(r.id, 'supervisor_approve')}><CheckCircle2 className="h-3.5 w-3.5" /></Button></TooltipTrigger><TooltipContent>Approve</TooltipContent></Tooltip></TooltipProvider>
                              <TooltipProvider><Tooltip><TooltipTrigger asChild><Button size="sm" variant="ghost" className="h-7 px-2 text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => { setRejectTarget({ id: r.id, action: 'supervisor_reject' }); setRejectOpen(true); }}><XCircle className="h-3.5 w-3.5" /></Button></TooltipTrigger><TooltipContent>Reject</TooltipContent></Tooltip></TooltipProvider>
                            </>
                          )}
                          {r.status === 'supervisor_approved' && canApproveAsStore(user, 'repair_material_requests.update') && (
                            <>
                              <TooltipProvider><Tooltip><TooltipTrigger asChild><Button size="sm" variant="ghost" className="h-7 px-2 text-teal-600 hover:text-teal-700 hover:bg-teal-50" onClick={() => handleAction(r.id, 'storekeeper_approve')}><Warehouse className="h-3.5 w-3.5" /></Button></TooltipTrigger><TooltipContent>Store Approve</TooltipContent></Tooltip></TooltipProvider>
                              <TooltipProvider><Tooltip><TooltipTrigger asChild><Button size="sm" variant="ghost" className="h-7 px-2 text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => { setRejectTarget({ id: r.id, action: 'storekeeper_reject' }); setRejectOpen(true); }}><XCircle className="h-3.5 w-3.5" /></Button></TooltipTrigger><TooltipContent>Reject</TooltipContent></Tooltip></TooltipProvider>
                            </>
                          )}
                          {r.status === 'storekeeper_approved' && canApproveAsStore(user, 'repair_material_requests.update') && (
                            <Button size="sm" className="h-7 gap-1 bg-violet-600 hover:bg-violet-700 text-white" onClick={(e) => { e.stopPropagation(); handlePick(r.id); }} disabled={submitting}>
                              <PackageOpen className="h-3.5 w-3.5" /> Pick
                            </Button>
                          )}
                          {r.status === 'picking' && canApproveAsStore(user, 'repair_material_requests.update') && (
                            <Button size="sm" className="h-7 gap-1 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={(e) => { e.stopPropagation(); handleAction(r.id, 'issue', { approvedQuantity: r.quantityApproved }); }} disabled={submitting}>
                              <PackageCheck className="h-3.5 w-3.5" /> Issue
                            </Button>
                          )}
                          {['issued', 'partially_returned', 'fully_returned'].includes(r.status) && canDeclareMaterialUsage(r, user) && (
                            <Button size="sm" variant="outline" className="h-7 gap-1 border-sky-400 text-sky-700 hover:bg-sky-50" onClick={(e) => { e.stopPropagation(); openUsageDeclaration(r); }}>
                              <ClipboardList className="h-3.5 w-3.5" /> Record Usage / Return
                            </Button>
                          )}
                          {['issued', 'partially_returned', 'fully_returned'].includes(r.status) && canApproveAsStore(user, 'repair_material_requests.update') && (
                            <>
                              <Button size="sm" variant="outline" className="h-7 gap-1 border-violet-400 text-violet-700 hover:bg-violet-50" onClick={(e) => { e.stopPropagation(); openStoreReconcile(r); }}>
                                <PackageCheck className="h-3.5 w-3.5" /> Verify & Reconcile
                              </Button>
                              {(r.quantityReturned ?? 0) < (r.quantityIssued ?? 0) && (
                                <Button size="sm" variant="outline" className="h-7 gap-1 border-amber-400 text-amber-700 hover:bg-amber-50" onClick={(e) => { e.stopPropagation(); setQtyTarget({ id: r.id, action: 'record_return', max: Math.max(0, (r.quantityIssued || 0) - (r.quantityReturned || 0)), field: 'quantityReturned' }); setQtyOpen(true); }}>
                                  <RotateCcw className="h-3.5 w-3.5" /> Record Return
                                </Button>
                              )}
                            </>
                          )}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7"><MoreHorizontal className="h-3.5 w-3.5" /></Button></DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => { setDetailItem(r); setDetailOpen(true); }}><Eye className="h-4 w-4 mr-2" /> View Details</DropdownMenuItem>
                              {(hasPermission('repair_material_requests.update') || hasPermission('work_orders.update') || isAdmin()) && r.status === 'pending' && r.requestedBy?.id === user?.id && <DropdownMenuItem className="text-red-600" onClick={() => handleDelete(r.id)}><Ban className="h-4 w-4 mr-2" /> Cancel</DropdownMenuItem>}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Showing page {pagination.page} of {pagination.totalPages} ({pagination.total} total)</p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
            <span className="text-sm font-medium">{page} / {pagination.totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= pagination.totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>
      )}

      {/* Detail Sheet */}
      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="sm:max-w-lg w-full overflow-y-auto">
          {detailItem && (
            <>
              <SheetHeader className="mb-4">
                <SheetTitle className="flex items-center gap-2"><Package className="h-5 w-5 text-amber-600" /> {detailItem.itemName}</SheetTitle>
                <SheetDescription>Material Request — {detailItem.workOrder?.woNumber}</SheetDescription>
              </SheetHeader>
              <div className="px-4 pb-4">
              <Tabs defaultValue="details">
                <TabsList className="w-full"><TabsTrigger value="details" className="flex-1">Details</TabsTrigger><TabsTrigger value="timeline" className="flex-1">Timeline</TabsTrigger></TabsList>
                <TabsContent value="details" className="mt-4 space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label className="text-xs text-muted-foreground">Status</Label><div className="mt-1"><StatusBadge status={detailItem.status} /></div></div>
                    <div><Label className="text-xs text-muted-foreground">Urgency</Label><div className="mt-1">{detailItem.urgency ? <UrgencyBadge urgency={detailItem.urgency} /> : '—'}</div></div>
                    <div><Label className="text-xs text-muted-foreground">Unit</Label><p className="text-sm mt-1">{detailItem.unit}</p></div>
                    <div><Label className="text-xs text-muted-foreground">Unit Cost</Label><p className="text-sm mt-1">{formatCurrency(detailItem.unitCost || 0)}</p></div>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Quantity Breakdown</Label>
                    <div className="grid grid-cols-4 gap-2">
                      {[
                        { label: 'Requested', val: detailItem.quantityRequested, color: 'text-foreground' },
                        { label: 'Approved', val: detailItem.quantityApproved ?? '—', color: 'text-sky-600' },
                        { label: 'Issued', val: detailItem.quantityIssued ?? '—', color: 'text-emerald-600' },
                        { label: 'Returned', val: detailItem.quantityReturned ?? '—', color: 'text-amber-600' },
                      ].map(q => (
                        <div key={q.label} className="bg-muted/50 rounded-lg p-2 text-center">
                          <p className={`text-lg font-bold ${q.color}`}>{q.val}</p><p className="text-[10px] text-muted-foreground">{q.label}</p>
                        </div>
                      ))}
                    </div>
                    {/* Reconciliation Status for issued/closed items */}
                    {(detailItem.status === 'issued' || detailItem.status === 'closed' || detailItem.status === 'picking') && (
                      <div className="grid grid-cols-3 gap-2 mt-2">
                        {[
                          { label: 'Consumed', val: detailItem.consumedQty ?? '—', color: 'text-teal-600', bg: 'bg-teal-50' },
                          { label: 'Wasted', val: detailItem.wastedQty ?? '—', color: 'text-red-500', bg: 'bg-red-50' },
                          { label: 'Variance', val: detailItem.consumedQty != null ? Math.max(0, (detailItem.quantityIssued || 0) - (detailItem.consumedQty || 0) - (detailItem.wastedQty || 0)) : '—', color: 'text-orange-600', bg: 'bg-orange-50' },
                        ].map(q => (
                          <div key={q.label} className={`${q.bg} rounded-lg p-2 text-center`}>
                            <p className={`text-lg font-bold ${q.color}`}>{q.val}</p><p className="text-[10px] text-muted-foreground">{q.label}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Requested By</Label>
                    <div className="flex items-center gap-2"><AvatarPlaceholder name={detailItem.requestedBy?.fullName || ''} /><span className="text-sm">{detailItem.requestedBy?.fullName}</span></div>
                  </div>
                  <div><Label className="text-xs text-muted-foreground">Reason</Label><p className="text-sm mt-1 bg-muted/50 rounded-lg p-3">{detailItem.reason}</p></div>
                  {detailItem.notes && <div><Label className="text-xs text-muted-foreground">Notes</Label><p className="text-sm mt-1 bg-muted/50 rounded-lg p-3">{detailItem.notes}</p></div>}
                  {((detailItem.status === 'pending' && canApproveAsSupervisor(detailItem, user, 'repair_material_requests.update')) || (detailItem.status === 'supervisor_approved' && canApproveAsStore(user, 'repair_material_requests.update')) || (detailItem.status === 'storekeeper_approved' && canApproveAsStore(user, 'repair_material_requests.update')) || (detailItem.status === 'picking' && canApproveAsStore(user, 'repair_material_requests.update')) || (['issued', 'partially_returned', 'fully_returned'].includes(detailItem.status) && (canApproveAsStore(user, 'repair_material_requests.update') || canDeclareMaterialUsage(detailItem, user)))) && (
                    <>
                      <Separator />
                      <div className="flex flex-wrap gap-2">
                        {detailItem.status === 'pending' && (
                          <>
                            <Button size="sm" className="gap-1 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => handleAction(detailItem.id, 'supervisor_approve')} disabled={submitting}><CheckCircle2 className="h-3.5 w-3.5" /> Approve</Button>
                            <Button size="sm" variant="destructive" onClick={() => { setRejectTarget({ id: detailItem.id, action: 'supervisor_reject' }); setRejectOpen(true); }} disabled={submitting}>Reject</Button>
                          </>
                        )}
                        {detailItem.status === 'supervisor_approved' && (
                          <>
                            <Button size="sm" className="gap-1 bg-teal-600 hover:bg-teal-700 text-white" onClick={() => handleAction(detailItem.id, 'storekeeper_approve')} disabled={submitting}><Warehouse className="h-3.5 w-3.5" /> Store Approve</Button>
                            <Button size="sm" variant="destructive" onClick={() => { setRejectTarget({ id: detailItem.id, action: 'storekeeper_reject' }); setRejectOpen(true); }} disabled={submitting}>Reject</Button>
                          </>
                        )}
                        {detailItem.status === 'storekeeper_approved' && (
                          <Button size="sm" className="gap-1 bg-violet-600 hover:bg-violet-700 text-white" onClick={() => handlePick(detailItem.id)} disabled={submitting}><PackageOpen className="h-3.5 w-3.5" /> Pick Items</Button>
                        )}
                        {detailItem.status === 'picking' && (
                          <Button size="sm" className="gap-1 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => handleAction(detailItem.id, 'issue', { approvedQuantity: detailItem.quantityApproved })} disabled={submitting}><PackageCheck className="h-3.5 w-3.5" /> Issue</Button>
                        )}
                        {['issued', 'partially_returned', 'fully_returned'].includes(detailItem.status) && canDeclareMaterialUsage(detailItem, user) && (
                          <Button size="sm" variant="outline" className="gap-1 border-sky-400 text-sky-700" onClick={() => openUsageDeclaration(detailItem)} disabled={submitting}><ClipboardList className="h-3.5 w-3.5" /> Record Usage / Return</Button>
                        )}
                        {['issued', 'partially_returned', 'fully_returned'].includes(detailItem.status) && canApproveAsStore(user, 'repair_material_requests.update') && (
                          <>
                            <Button size="sm" variant="outline" className="gap-1 border-violet-400 text-violet-700" onClick={() => openStoreReconcile(detailItem)} disabled={submitting}><PackageCheck className="h-3.5 w-3.5" /> Verify Return & Reconcile</Button>
                            {(detailItem.quantityReturned ?? 0) < (detailItem.quantityIssued ?? 0) && (
                              <Button size="sm" variant="outline" className="gap-1 border-amber-400 text-amber-700" onClick={() => { setQtyTarget({ id: detailItem.id, action: 'record_return', max: Math.max(0, (detailItem.quantityIssued || 0) - (detailItem.quantityReturned || 0)), field: 'quantityReturned' }); setQtyOpen(true); }} disabled={submitting}><RotateCcw className="h-3.5 w-3.5" /> Record Return</Button>
                            )}
                          </>
                        )}
                      </div>
                    </>
                  )}
                </TabsContent>
                <TabsContent value="timeline" className="mt-4">
                  <DetailTimeline events={[
                    { label: 'Request Created', date: detailItem.createdAt, user: detailItem.requestedBy?.fullName, status: 'active' },
                    { label: 'Supervisor Approval', date: detailItem.supervisorApprovedAt, user: detailItem.supervisorApprovedBy?.fullName, status: detailItem.status },
                    { label: 'Store Approval', date: detailItem.storekeeperApprovedAt, user: detailItem.storekeeperApprovedBy?.fullName, status: detailItem.status },
                    { label: 'Items Picked', date: detailItem.pickedAt, user: detailItem.pickedByUser?.fullName },
                    { label: 'Material Issued', date: detailItem.issuedAt, user: detailItem.issuedBy?.fullName },
                    { label: 'Reconciliation', date: detailItem.consumedQty != null ? detailItem.updatedAt : undefined, notes: detailItem.consumedQty != null ? `Consumed: ${detailItem.consumedQty}, Wasted: ${detailItem.wastedQty ?? 0}` : undefined },
                    { label: 'Material Returned', date: detailItem.returnedAt, user: detailItem.returnedBy?.fullName },
                  ].filter(e => e.date || e.status === 'active' || e.notes)} />
                </TabsContent>
              </Tabs>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Create Dialog */}
      <ResponsiveDialog open={createOpen} onOpenChange={setCreateOpen}>
        
          <div className="space-y-1.5 mb-4"><h2 className="text-lg font-semibold leading-none tracking-tight">New Material Request</h2><p className="text-sm text-muted-foreground">Request materials/spare parts for a work order</p></div>
          <div className="space-y-4">
            <div><Label>Work Order *</Label><AsyncSearchableSelect value={createForm.workOrderId} onValueChange={(v) => setCreateForm(f => ({ ...f, workOrderId: v, componentRegistryId: '' }))} placeholder="Select work order..." searchPlaceholder="Search work orders..." fetchOptions={async () => { const res = await api.get('/api/work-orders?limit=999'); if (res.success && Array.isArray(res.data)) return res.data.map((w: any) => ({ value: w.id, label: `${w.woNumber} — ${w.title}` })); return []; }} /></div>
            <div><Label>Item Name *</Label><AsyncSearchableSelect value={createForm.itemId} onValueChange={(v) => { const item = inventoryItemsCache.current.find((i: any) => i.id === v); setCreateForm(f => ({ ...f, itemId: v, itemName: item ? (item.name + (item.itemCode ? ` (${item.itemCode})` : '')) : '' })); }} placeholder="Search inventory items..." searchPlaceholder="Search by name or code..." fetchOptions={fetchInventoryItems} /></div>
            <div><Label>Component <span className="text-xs text-muted-foreground">(optional)</span></Label><AsyncSearchableSelect value={createForm.componentRegistryId} onValueChange={(v) => setCreateForm(f => ({ ...f, componentRegistryId: v }))} placeholder="Select component..." searchPlaceholder="Search components..." fetchOptions={async () => { if (!createForm.workOrderId) return []; try { const res = await api.get(`/api/work-orders/${createForm.workOrderId}`); if (res.success && res.data?.assetId) { const compRes = await api.get(`/api/component-registry?assetId=${res.data.assetId}`); if (compRes.success && Array.isArray(compRes.data)) return compRes.data.map((c: any) => ({ value: c.id, label: `${c.componentCode || ''} ${c.name}`.trim() })); } } catch {} return []; }} /></div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Quantity *</Label><Input type="number" value={createForm.quantityRequested} onChange={(e) => setCreateForm({ ...createForm, quantityRequested: e.target.value })} /></div>
              <div><Label>Unit</Label><Select value={createForm.unit} onValueChange={(v) => setCreateForm({ ...createForm, unit: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="each">Each</SelectItem><SelectItem value="kg">Kg</SelectItem><SelectItem value="meter">Meter</SelectItem><SelectItem value="set">Set</SelectItem><SelectItem value="liter">Liter</SelectItem></SelectContent></Select></div>
              <div><Label>Unit Cost</Label><Input type="number" step="0.01" value={createForm.unitCost} onChange={(e) => setCreateForm({ ...createForm, unitCost: e.target.value })} /></div>
            </div>
            {estimatedCost > 0 && <div className="bg-teal-50 border border-teal-200 rounded-lg p-3 flex items-center gap-2"><DollarSign className="h-4 w-4 text-teal-600" /><span className="text-sm font-medium text-teal-700">Estimated cost: {formatCurrency(estimatedCost)}</span></div>}
            <div><Label>Urgency</Label><div className="flex gap-2 mt-1">{Object.entries(URGENCY_CONFIG).map(([key, cfg]) => (<button key={key} onClick={() => setCreateForm(f => ({ ...f, urgency: key }))} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border-2 text-xs font-medium transition-all ${createForm.urgency === key ? cfg.color + ' ring-2 ring-offset-1 ring-gray-300' : 'border-gray-200 text-muted-foreground hover:border-gray-300'}`}><span className={`h-2 w-2 rounded-full ${cfg.dotColor}`} />{cfg.label}</button>))}</div></div>
            <div><Label>Reason * <span className="text-xs text-muted-foreground">(min 5 chars)</span></Label><Textarea value={createForm.reason} onChange={(e) => setCreateForm({ ...createForm, reason: e.target.value })} placeholder="Why is this material needed?" rows={3} /></div>
            <div><Label>Notes</Label><Textarea value={createForm.notes} onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })} placeholder="Additional information..." rows={2} /></div>
          </div>
          <div className="flex flex-col-reverse gap-2 mt-4 sm:flex-row sm:justify-end"><Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button><Button onClick={handleCreate} disabled={submitting} className="gap-2"><Send className="h-4 w-4" /> Submit Request</Button></div>
        
      </ResponsiveDialog>

      <RejectDialog open={rejectOpen} onClose={() => { setRejectOpen(false); setRejectTarget(null); }} onConfirm={(reason) => { if (rejectTarget) handleAction(rejectTarget.id, rejectTarget.action, { notes: reason }); }} title="Reject Material Request" />
      <QuantityDialog open={qtyOpen} onClose={() => { setQtyOpen(false); setQtyTarget(null); }} onConfirm={(qty, condition) => { if (qtyTarget) handleAction(qtyTarget.id, qtyTarget.action, { [qtyTarget.field]: qty, returnCondition: condition }); }} title="Return Quantity" description={`Enter quantity and verify its physical condition (max ${qtyTarget?.max || 0})`} max={qtyTarget?.max || 0} fieldLabel="Quantity to Return" />

      {/* Technician Material Usage Declaration */}
      <ResponsiveDialog open={usageDeclarationOpen} onOpenChange={(v) => { if (!v) { setUsageDeclarationOpen(false); setUsageDeclarationTarget(null); setUsageDeclarationForm({ consumedQty: '', wastedQty: '0', returnQty: '', notes: '' }); } }}>
        <div className="space-y-1.5 mb-4">
          <h2 className="text-lg font-semibold leading-none tracking-tight">Record Material Usage / Return</h2>
          <p className="text-sm text-muted-foreground">Account for all {usageDeclarationTarget?.quantityIssued} {usageDeclarationTarget?.unit} issued. The store will verify the physical return and finalize reconciliation.</p>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label>Used *</Label>
              <Input type="number" min={0} value={usageDeclarationForm.consumedQty} onChange={e => setUsageDeclarationForm(f => ({ ...f, consumedQty: e.target.value }))} placeholder="0" />
              <p className="text-[11px] text-muted-foreground mt-1">Actually used in the repair</p>
            </div>
            <div>
              <Label>Wasted / Damaged *</Label>
              <Input type="number" min={0} value={usageDeclarationForm.wastedQty} onChange={e => setUsageDeclarationForm(f => ({ ...f, wastedQty: e.target.value }))} placeholder="0" />
              <p className="text-[11px] text-muted-foreground mt-1">Lost, damaged or unusable</p>
            </div>
            <div>
              <Label>To Return *</Label>
              <Input type="number" min={0} value={usageDeclarationForm.returnQty} onChange={e => setUsageDeclarationForm(f => ({ ...f, returnQty: e.target.value }))} placeholder="0" />
              <p className="text-[11px] text-muted-foreground mt-1">Physically returning to store</p>
            </div>
          </div>
          <div className="rounded-lg bg-muted/50 p-3 text-xs">
            Accounted: <strong>{(Number(usageDeclarationForm.consumedQty) || 0) + (Number(usageDeclarationForm.wastedQty) || 0) + (Number(usageDeclarationForm.returnQty) || 0)}</strong>
            {' / '}Issued: <strong>{usageDeclarationTarget?.quantityIssued || 0}</strong>
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea value={usageDeclarationForm.notes} onChange={e => setUsageDeclarationForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional note about usage, damage or return..." rows={2} />
          </div>
        </div>
        <div className="flex flex-col-reverse gap-2 mt-4 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => setUsageDeclarationOpen(false)}>Cancel</Button>
          <Button className="bg-sky-600 hover:bg-sky-700 text-white gap-2" onClick={handleUsageDeclaration} disabled={submitting || usageDeclarationForm.consumedQty === '' || usageDeclarationForm.returnQty === ''}>
            <ClipboardList className="h-4 w-4" /> Submit Usage Declaration
          </Button>
        </div>
      </ResponsiveDialog>

      {/* Reconciliation Dialog */}
      <ResponsiveDialog open={reconcileOpen} onOpenChange={(v) => { if (!v) { setReconcileOpen(false); setReconcileTarget(null); setReconcileForm({ consumedQty: '', wastedQty: '', returnCondition: '', notes: '' }); } }}>
        
          <div className="space-y-1.5 mb-4">
            <h2 className="text-lg font-semibold leading-none tracking-tight">Verify Return & Reconcile</h2>
            <p className="text-sm text-muted-foreground">Verify the technician declaration and physical return for {reconcileTarget?.itemName} — Issued: {reconcileTarget?.quantityIssued} {reconcileTarget?.unit}</p>
            {reconcileTarget?.usageDeclaredAt ? (
              <div className="mt-3 rounded-lg border bg-sky-50/60 p-3 text-xs text-sky-900">
                <div className="font-semibold mb-1">Technician declaration</div>
                <div>Used: <strong>{reconcileTarget.declaredConsumedQty ?? 0}</strong> · Wasted/Damaged: <strong>{reconcileTarget.declaredWastedQty ?? 0}</strong> · To Return: <strong>{reconcileTarget.declaredReturnQty ?? 0}</strong></div>
                {reconcileTarget.usageDeclarationNotes && <div className="mt-1 text-sky-800">{reconcileTarget.usageDeclarationNotes}</div>}
                <div className="mt-1 text-sky-700">If store verification changes these figures, enter an explanatory note before confirming.</div>
              </div>
            ) : (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                No technician usage declaration has been submitted. A documented reconciliation note is required for this exception.
              </div>
            )}
          </div>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Consumed Quantity *</Label>
                <Input type="number" value={reconcileForm.consumedQty} onChange={e => setReconcileForm(f => ({ ...f, consumedQty: e.target.value }))} placeholder="Amount consumed" min={0} max={reconcileTarget?.quantityIssued || 0} />
                <p className="text-[11px] text-muted-foreground mt-1">Material actually used in the repair</p>
              </div>
              <div>
                <Label>Wasted Quantity</Label>
                <Input type="number" value={reconcileForm.wastedQty} onChange={e => setReconcileForm(f => ({ ...f, wastedQty: e.target.value }))} placeholder="Amount discarded" min={0} />
                <p className="text-[11px] text-muted-foreground mt-1">Material discarded/damaged</p>
              </div>
            </div>
            {/* Live reconciliation preview */}
            {reconcileForm.consumedQty && (
              <div className="bg-muted/50 rounded-lg p-3 space-y-1">
                <p className="text-xs font-medium text-muted-foreground mb-1">Reconciliation Preview</p>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-sm font-bold text-teal-600">{parseFloat(reconcileForm.consumedQty) || 0}</p>
                    <p className="text-[10px] text-muted-foreground">Consumed</p>
                  </div>
                  <div>
                    <p className="text-sm font-bold text-red-500">{parseFloat(reconcileForm.wastedQty) || 0}</p>
                    <p className="text-[10px] text-muted-foreground">Wasted</p>
                  </div>
                  <div>
                    <p className="text-sm font-bold text-orange-600">{Math.max(0, (reconcileTarget?.quantityIssued || 0) - (parseFloat(reconcileForm.consumedQty) || 0) - (parseFloat(reconcileForm.wastedQty) || 0))}</p>
                    <p className="text-[10px] text-muted-foreground">To Return</p>
                  </div>
                </div>
                {(parseFloat(reconcileForm.consumedQty) || 0) + (parseFloat(reconcileForm.wastedQty) || 0) > (reconcileTarget?.quantityIssued || 0) && (
                  <p className="text-xs text-red-600 mt-1">⚠ Total exceeds issued quantity</p>
                )}
              </div>
            )}
            {Math.max(0, Number(reconcileTarget?.quantityIssued || 0) - (parseFloat(reconcileForm.consumedQty) || 0) - (parseFloat(reconcileForm.wastedQty) || 0) - Number(reconcileTarget?.quantityReturned || 0)) > 0.001 && (
              <div className="space-y-2">
                <Label>Return condition *</Label>
                <Select value={reconcileForm.returnCondition} onValueChange={(value) => setReconcileForm(f => ({ ...f, returnCondition: value }))}>
                  <SelectTrigger><SelectValue placeholder="Verify physical condition before store acceptance" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="serviceable">Serviceable — return to usable stock</SelectItem>
                    <SelectItem value="damaged">Damaged — quarantine for inspection / repair</SelectItem>
                    <SelectItem value="defective">Defective — quarantine for inspection / repair</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">Damaged or defective items stay outside usable inventory until inspection/refurbishment custody releases them.</p>
              </div>
            )}
            <div>
              <Label>Notes</Label>
              <Textarea value={reconcileForm.notes} onChange={e => setReconcileForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes about consumption..." rows={2} />
            </div>
          </div>
          <div className="flex flex-col-reverse gap-2 mt-4 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => { setReconcileOpen(false); setReconcileTarget(null); setReconcileForm({ consumedQty: '', wastedQty: '', returnCondition: '', notes: '' }); }}>Cancel</Button>
            <Button className="bg-violet-600 hover:bg-violet-700 text-white gap-2" onClick={handleReconcile} disabled={submitting || !reconcileForm.consumedQty || (Math.max(0, Number(reconcileTarget?.quantityIssued || 0) - (parseFloat(reconcileForm.consumedQty) || 0) - (parseFloat(reconcileForm.wastedQty) || 0) - Number(reconcileTarget?.quantityReturned || 0)) > 0.001 && !reconcileForm.returnCondition)}>
              <PackageCheck className="h-4 w-4" /> Confirm Reconciliation
            </Button>
          </div>
        
      </ResponsiveDialog>
    </div>
  );
}

// ============================================================================
// PAGE 2: REPAIR TOOL REQUESTS (Multi-tool with quantity tracking)
// ============================================================================

type ToolItemRow = {
  toolId: string;
  toolName: string;
  toolCode: string;
  category: string;
  quantityRequested: number;
  availableQty: number;
};

export function RepairToolRequestsPage() {
  const { user, hasPermission, isAdmin } = useAuthStore();
  const { pageParams } = useNavigationStore();
  const repairsEnabled = useModuleEnabled(MODULE_CODES.REPAIRS);
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any>(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterUrgency, setFilterUrgency] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<any>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<{ id: string; action: string } | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [workOrderIdFilter, setWorkOrderIdFilter] = useState('');
  const [pagination, setPagination] = useState<any>(null);

  const [viewMode, setViewMode] = useState<'all' | 'mine'>('all');

  const canViewAll = canViewAllRepairData(user, ['repair_tool_requests.view', 'repair_tool_requests.view_all']);
  // Auto-switch to 'mine' if user doesn't have view_all permission
  useEffect(() => {
    if (!canViewAll && viewMode === 'all') setViewMode('mine');
  }, [canViewAll]);

  // Issue / Return dialog state
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueForm, setIssueForm] = useState<any[]>([]);
  const [returnItemsOpen, setReturnItemsOpen] = useState(false);
  const [returnItemsForm, setReturnItemsForm] = useState<any[]>([]);
  // Transfer dialog state
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [transferForm, setTransferForm] = useState<any[]>([]);

  // Cache for tool lookup (used by AsyncSearchableSelect)
  const toolsCache = useRef<any[]>([]);
  const fetchTools = useCallback(async () => {
    const res = await api.get('/api/tools?mode=lookup&limit=500');
    if (res.success && Array.isArray(res.data)) {
      toolsCache.current = res.data;
      return res.data.map((t: any) => ({ value: t.id, label: `${t.name}${t.toolCode ? ` (${t.toolCode})` : ''}${t.serialNumber ? ` [${t.serialNumber}]` : ''}` }));
    }
    return [];
  }, []);

  // ── Create form state (multi-tool) ──
  const [createForm, setCreateForm] = useState({
    workOrderId: '',
    reason: '',
    notes: '',
    urgency: 'medium',
    items: [] as ToolItemRow[],
  });

  // ── Edit form state (multi-tool) ──
  const [editForm, setEditForm] = useState({
    reason: '',
    notes: '',
    urgency: 'medium',
    items: [] as ToolItemRow[],
  });

  const emptyItemRow = (): ToolItemRow => ({ toolId: '', toolName: '', toolCode: '', category: '', quantityRequested: 1, availableQty: 999 });

  useEffect(() => {
    if (pageParams?.workOrderId) {
      setWorkOrderIdFilter(pageParams.workOrderId);
    }
  }, []);

  const activeFilters = useMemo(() => {
    let c = 0; if (filterStatus !== 'all') c++; if (filterUrgency !== 'all') c++; if (searchText) c++; if (workOrderIdFilter) c++; return c;
  }, [filterStatus, filterUrgency, searchText, workOrderIdFilter]);
  const clearFilters = () => { setFilterStatus('all'); setFilterUrgency('all'); setSearchText(''); setWorkOrderIdFilter(''); setPage(1); };

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterStatus !== 'all') params.set('status', filterStatus);
    if (filterUrgency !== 'all') params.set('urgency', filterUrgency);
    if (workOrderIdFilter) params.set('workOrderId', workOrderIdFilter);
    params.set('page', String(page));
    params.set('limit', '50');
    const [listRes, statsRes] = await Promise.all([
      api.get(`/api/repairs/tool-requests?${params}`),
      api.get('/api/repairs/tool-requests?stats=true'),
    ]);
    if (listRes.success) setRequests(listRes.data || []); else toast.error(listRes.error || 'Failed');
    if (listRes.pagination) setPagination(listRes.pagination);
    if (statsRes.success) setStats(statsRes.data);
    setLoading(false);
  }, [filterStatus, filterUrgency, page, workOrderIdFilter]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  // ── Helper: get display items for a request (handles virtual items for old data) ──
  const getRequestItems = (r: any) => {
    if (r.items && r.items.length > 0) return r.items;
    if (r._virtualItem) return [r._virtualItem];
    return [];
  };

  /** True if ANY item still has qty outstanding (issued > returned + transferred) */
  const hasOutstandingItems = (r: any) => {
    const items = getRequestItems(r);
    if (items.length === 0) {
      // Single-tool request: outstanding if status is still 'issued'
      return r.status === 'issued';
    }
    return items.some((i: any) => {
      const issued = i.quantityIssued || 0;
      const ret = i.quantityReturned || 0;
      const xfer = i.quantityTransferred || 0;
      return (ret + xfer) < issued;
    });
  };

  const getToolNamesSummary = (r: any) => {
    const items = getRequestItems(r);
    if (items.length === 0) return r.toolName || '—';
    const names = items.map((i: any) => i.toolName).filter(Boolean);
    if (names.length <= 2) return names.join(', ');
    return `${names.length} tools: ${names.slice(0, 2).join(', ')}, +${names.length - 2} more`;
  };

  const getTotalRequested = (r: any) => {
    const items = getRequestItems(r);
    return items.reduce((sum: number, i: any) => sum + (i.quantityRequested || 1), 0);
  };

  const getFulfillmentRatio = (r: any) => {
    const items = getRequestItems(r);
    const totalRequested = items.reduce((sum: number, i: any) => sum + (i.quantityRequested || 1), 0);
    const totalIssued = items.reduce((sum: number, i: any) => sum + (i.quantityIssued || 0), 0);
    return { issued: totalIssued, requested: totalRequested };
  };

  // ── Create handlers ──
  const addCreateItem = () => {
    setCreateForm(f => ({ ...f, items: [...f.items, emptyItemRow()] }));
  };

  const removeCreateItem = (idx: number) => {
    setCreateForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));
  };

  const updateCreateItem = (idx: number, patch: Partial<ToolItemRow>) => {
    setCreateForm(f => ({
      ...f,
      items: f.items.map((item, i) => i === idx ? { ...item, ...patch } : item),
    }));
  };

  const handleCreate = async () => {
    if (!createForm.workOrderId || !createForm.reason || createForm.reason.length < 5) {
      toast.error('Work Order and Reason (min 5 chars) are required'); return;
    }
    const validItems = createForm.items.filter(i => i.toolName.trim());
    if (validItems.length === 0) {
      toast.error('At least one tool item is required'); return;
    }
    setSubmitting(true);
    const res = await api.post('/api/repairs/tool-requests', {
      workOrderId: createForm.workOrderId,
      items: validItems.map(i => ({
        toolId: i.toolId || undefined,
        toolName: i.toolName,
        toolCode: i.toolCode || undefined,
        category: i.category || undefined,
        quantityRequested: i.quantityRequested,
      })),
      reason: createForm.reason,
      notes: createForm.notes || undefined,
      urgency: createForm.urgency,
    });
    if (res.success) {
      toast.success('Tool request created');
      if (res.warnings) res.warnings.forEach((w: string) => toast.warning(w));
      setCreateOpen(false);
      setCreateForm({ workOrderId: '', reason: '', notes: '', urgency: 'medium', items: [] });
      fetchRequests();
    } else {
      toast.error(res.error || 'Failed');
    }
    setSubmitting(false);
  };

  // ── Action handler ──
  const handleAction = async (id: string, action: string, extra?: Record<string, any>) => {
    setSubmitting(true);
    const res = await api.post(`/api/repairs/tool-requests/${id}`, { action, ...extra });
    if (res.success) {
      toast.success('Action completed');
      if (res.warnings) res.warnings.forEach((w: string) => toast.warning(w));
      fetchRequests();
      // Re-fetch detail if open
      if (detailOpen && detailItem?.id === id) {
        const detailRes = await api.get(`/api/repairs/tool-requests/${id}`);
        if (detailRes.success) setDetailItem(detailRes.data);
        else setDetailOpen(false);
      }
    } else {
      toast.error(res.error || 'Failed');
    }
    setSubmitting(false);
  };

  // ── Edit form ──
  const openEditForm = async () => {
    if (!detailItem) return;
    // Fetch full detail to get items
    let fullDetail = detailItem;
    if (!detailItem.items || detailItem.items.length === 0) {
      const res = await api.get(`/api/repairs/tool-requests/${detailItem.id}`);
      if (res.success) fullDetail = res.data;
    }

    const existingItems = getRequestItems(fullDetail);
    const editItems: ToolItemRow[] = existingItems.length > 0
      ? existingItems.map((i: any) => ({
          toolId: i.toolId || '',
          toolName: i.toolName || '',
          toolCode: i.toolCode || '',
          category: i.category || '',
          quantityRequested: i.quantityRequested || 1,
          availableQty: i.tool?.quantity ?? 999,
        }))
      : [emptyItemRow()];

    setEditForm({
      reason: fullDetail.reason || '',
      notes: fullDetail.notes || '',
      urgency: fullDetail.urgency || 'medium',
      items: editItems,
    });
    setEditOpen(true);
  };

  const addEditItem = () => {
    setEditForm(f => ({ ...f, items: [...f.items, emptyItemRow()] }));
  };

  const removeEditItem = (idx: number) => {
    setEditForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));
  };

  const updateEditItem = (idx: number, patch: Partial<ToolItemRow>) => {
    setEditForm(f => ({
      ...f,
      items: f.items.map((item, i) => i === idx ? { ...item, ...patch } : item),
    }));
  };

  const handleEdit = async () => {
    if (!editForm.reason || editForm.reason.length < 5) {
      toast.error('Reason (min 5 chars) is required');
      return;
    }
    const validItems = editForm.items.filter(i => i.toolName.trim());
    if (validItems.length === 0) {
      toast.error('At least one tool item is required');
      return;
    }
    setSubmitting(true);
    const res = await api.put(`/api/repairs/tool-requests/${detailItem.id}`, {
      reason: editForm.reason,
      notes: editForm.notes || undefined,
      urgency: editForm.urgency,
      items: validItems.map(i => ({
        toolId: i.toolId || undefined,
        toolName: i.toolName,
        toolCode: i.toolCode || undefined,
        category: i.category || undefined,
        quantityRequested: i.quantityRequested,
      })),
    });
    if (res.success) {
      toast.success('Tool request updated');
      if (res.warnings) res.warnings.forEach((w: string) => toast.warning(w));
      setEditOpen(false);
      const detailRes = await api.get(`/api/repairs/tool-requests/${detailItem.id}`);
      if (detailRes.success) setDetailItem(detailRes.data);
      fetchRequests();
    } else {
      toast.error(res.error || 'Failed to update');
    }
    setSubmitting(false);
  };

  const handleDelete = async () => {
    setSubmitting(true);
    const res = await api.delete(`/api/repairs/tool-requests/${detailItem.id}`);
    if (res.success) {
      toast.success('Tool request deleted');
      setDeleteOpen(false);
      setDetailOpen(false);
      setDetailItem(null);
      fetchRequests();
    } else {
      toast.error(res.error || 'Failed to delete');
    }
    setSubmitting(false);
  };

  // ── Issue dialog ──
  const openIssueDialog = async () => {
    if (!detailItem) return;
    let fullDetail = detailItem;
    if (!detailItem.items || detailItem.items.length === 0) {
      const res = await api.get(`/api/repairs/tool-requests/${detailItem.id}`);
      if (res.success) fullDetail = res.data;
    }
    const items = getRequestItems(fullDetail);
    const form = items.map((i: any) => ({
      itemId: i.id,
      toolName: i.toolName || '',
      toolCode: i.toolCode || '',
      quantityRequested: i.quantityRequested || 1,
      quantityApproved: i.quantityApproved ?? i.quantityRequested ?? 1,
      quantityIssued: i.quantityApproved ?? i.quantityRequested ?? 1,
      availableQty: i.tool?.quantity ?? 0,
      issueNotes: '',
    }));
    setIssueForm(form);
    setIssueOpen(true);
  };

  const handleIssue = async () => {
    if (!detailItem) return;
    const issuedItems = issueForm.map(f => ({
      itemId: f.itemId,
      quantityIssued: Math.max(0, Math.min(f.quantityIssued, f.availableQty)),
      issueNotes: f.issueNotes || undefined,
    }));
    setSubmitting(true);
    const res = await api.post(`/api/repairs/tool-requests/${detailItem.id}`, {
      action: 'issue',
      issuedItems,
    });
    if (res.success) {
      toast.success('Tools issued successfully');
      if (res.warnings) res.warnings.forEach((w: string) => toast.warning(w));
      setIssueOpen(false);
      const detailRes = await api.get(`/api/repairs/tool-requests/${detailItem.id}`);
      if (detailRes.success) setDetailItem(detailRes.data);
      fetchRequests();
    } else {
      toast.error(res.error || 'Failed to issue');
    }
    setSubmitting(false);
  };

  // ── Return dialog ──
  const openReturnDialog = async () => {
    if (!detailItem) return;
    if (detailItem.status === 'pending_return') {
      toast.error('A return is already pending store keeper confirmation');
      return;
    }
    let fullDetail = detailItem;
    if (!detailItem.items || detailItem.items.length === 0) {
      const res = await api.get(`/api/repairs/tool-requests/${detailItem.id}`);
      if (res.success) fullDetail = res.data;
    }
    const items = getRequestItems(fullDetail);
    // Only include items that still have remaining qty to return (subtract transferred)
    const form = items.map((i: any) => ({
      itemId: i.id,
      toolName: i.toolName || '',
      toolCode: i.toolCode || '',
      quantityIssued: i.quantityIssued || 0,
      quantityAlreadyReturned: (i.quantityReturned || 0) + (i.quantityTransferred || 0),
      quantityReturned: (i.quantityIssued || 0) - (i.quantityReturned || 0) - (i.quantityTransferred || 0),
      conditionAtReturn: i.conditionAtIssue || 'good',
      notes: '',
    })).filter(f => f.quantityReturned > 0);
    setReturnItemsForm(form);
    setReturnItemsOpen(true);
  };

  const handleReturn = async () => {
    if (!detailItem) return;
    const returnedItems = returnItemsForm.filter(f => f.quantityReturned > 0).map(f => ({
      itemId: f.itemId,
      quantityReturned: Math.max(0, Math.min(f.quantityReturned, f.quantityIssued - f.quantityAlreadyReturned)),
      conditionAtReturn: f.conditionAtReturn,
      notes: f.notes?.trim() || undefined,
    }));
    setSubmitting(true);
    const res = await api.post(`/api/repairs/tool-requests/${detailItem.id}`, {
      action: 'return',
      returnedItems,
    });
    if (res.success) {
      toast.success('Return submitted — awaiting store keeper confirmation');
      if (res.warnings) res.warnings.forEach((w: string) => toast.warning(w));
      setReturnItemsOpen(false);
      const detailRes = await api.get(`/api/repairs/tool-requests/${detailItem.id}`);
      if (detailRes.success) setDetailItem(detailRes.data);
      fetchRequests();
    } else {
      toast.error(res.error || 'Failed to return');
    }
    setSubmitting(false);
  };

  // ── Transfer dialog ──
  const openTransferDialog = async () => {
    if (!detailItem) return;
    let fullDetail = detailItem;
    if (!detailItem.items || detailItem.items.length === 0) {
      const res = await api.get(`/api/repairs/tool-requests/${detailItem.id}`);
      if (res.success) fullDetail = res.data;
    }
    const items = getRequestItems(fullDetail);
    // Only include items that still have remaining qty
    const form = items.map((i: any) => ({
      itemId: i.id,
      toolId: i.toolId || detailItem.toolId || '',
      toolName: i.toolName || '',
      toolCode: i.toolCode || '',
      quantityIssued: i.quantityIssued || 0,
      quantityReturned: i.quantityReturned || 0,
      quantityToTransfer: (i.quantityIssued || 1) - (i.quantityReturned || 0) - (i.quantityTransferred || 0),
      toUserId: '',
      toUserName: '',
      transferReason: '',
    })).filter(f => f.quantityToTransfer > 0);
    setTransferForm(form);
    setTransferDialogOpen(true);
  };

  const handleTransfer = async () => {
    if (!detailItem) return;
    const itemsToTransfer = transferForm.filter(f => f.quantityToTransfer > 0);
    if (itemsToTransfer.length === 0) {
      toast.error('Select at least one tool to transfer');
      return;
    }
    for (const item of itemsToTransfer) {
      if (!item.toUserId) {
        toast.error(`Select a receiving technician for "${item.toolName}"`);
        return;
      }
      if (!item.transferReason || item.transferReason.length < 5) {
        toast.error(`Enter a reason for transferring "${item.toolName}" (min 5 chars)`);
        return;
      }
    }
    setSubmitting(true);
    let errors: string[] = [];
    for (const item of itemsToTransfer) {
      try {
        const res = await api.post('/api/repairs/tool-transfers', {
          toolId: item.toolId,
          toUserId: item.toUserId,
          reason: item.transferReason,
          notes: `WO transfer: ${item.quantityToTransfer}x ${item.toolName}`,
        });
        if (!res.success) errors.push(res.error || `Failed to transfer "${item.toolName}"`);
        else toast.success(`Transfer request submitted for "${item.toolName}"`);
      } catch (e: any) { errors.push(`Transfer error: ${e.message}`); }
    }
    if (errors.length > 0) errors.forEach(e => toast.error(e));
    else {
      setTransferDialogOpen(false);
      const detailRes = await api.get(`/api/repairs/tool-requests/${detailItem.id}`);
      if (detailRes.success) setDetailItem(detailRes.data);
      fetchRequests();
    }
    setSubmitting(false);
  };

  const filtered = useMemo(() => requests.filter(r =>
    !searchText || r.toolName?.toLowerCase().includes(searchText.toLowerCase()) || r.workOrder?.woNumber?.toLowerCase().includes(searchText.toLowerCase()) || r.requestNumber?.toLowerCase().includes(searchText.toLowerCase())
  ), [requests, searchText]);

  // ── Availability badge helper ──
  const AvailabilityBadge = ({ status }: { status?: string | null }) => {
    if (!status || status === 'available') return <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">Available</Badge>;
    if (status === 'limited') return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-xs">Limited</Badge>;
    return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-xs">Unavailable</Badge>;
  };

  // ── Tool item selector row (used in create & edit forms) ──
  const ToolItemRowEditor = ({ item, index, onUpdate, onRemove, canRemove }: {
    item: ToolItemRow; index: number;
    onUpdate: (idx: number, patch: Partial<ToolItemRow>) => void;
    onRemove: (idx: number) => void;
    canRemove: boolean;
  }) => (
    <div className="flex flex-col sm:flex-row gap-2 p-3 bg-muted/30 rounded-lg border">
      <div className="flex-1 min-w-0">
        <AsyncSearchableSelect
          value={item.toolId}
          onValueChange={(v) => {
            const tool = toolsCache.current.find((t: any) => t.id === v);
            if (tool) {
              onUpdate(index, {
                toolId: v,
                toolName: tool.name,
                toolCode: tool.toolCode || '',
                category: tool.category || '',
                availableQty: tool.quantity ?? 0,
              });
            }
          }}
          placeholder="Search tools..."
          searchPlaceholder="Search by name or code..."
          fetchOptions={fetchTools}
        />
      </div>
      <div className="w-full sm:w-20">
        <Label className="text-xs text-muted-foreground">Qty</Label>
        <Input type="number" min={1} max={item.availableQty || 999} value={item.quantityRequested}
          onChange={e => onUpdate(index, { quantityRequested: Math.max(1, parseInt(e.target.value) || 1) })}
          className="h-9 mt-0.5" />
      </div>
      <div className="flex items-end gap-1">
        {item.toolId && (
          <div className="flex items-center gap-1 pb-1">
            {item.availableQty > 0 && item.availableQty < item.quantityRequested && (
              <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-[10px] h-5">
                {item.availableQty} in stock
              </Badge>
            )}
            {item.availableQty <= 0 && (
              <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-[10px] h-5">
                Out of stock
              </Badge>
            )}
            {item.availableQty >= item.quantityRequested && item.toolId && (
              <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] h-5">
                In stock
              </Badge>
            )}
          </div>
        )}
        {canRemove && (
          <Button variant="ghost" size="icon" className="h-9 w-9 text-red-400 hover:text-red-600 hover:bg-red-50" onClick={() => onRemove(index)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );

  if (!repairsEnabled) {
    return (<div className="flex items-center justify-center h-96"><div className="text-center"><p className="text-muted-foreground">Repairs module is not active.</p><p className="text-sm text-muted-foreground mt-1">Enable it in Settings → Modules.</p></div></div>);
  }

  return (
    <div className="page-content">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-orange-100 rounded-xl"><Wrench className="h-6 w-6 text-orange-700" /></div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold tracking-tight">Tool Requests</h2>
              <Badge variant="secondary" className="font-mono">{requests.length}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">Request and track tools for repair work orders</p>
          </div>
        </div>
        {(user && (hasPermission('repair_tool_requests.create') || isAdmin())) && <Button onClick={() => { setCreateForm({ workOrderId: '', reason: '', notes: '', urgency: 'medium', items: [emptyItemRow()] }); setCreateOpen(true); }} className="gap-2"><Plus className="h-4 w-4" /> New Request</Button>}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatsCard icon={Clock} count={stats?.byStatus?.pending ?? requests.filter(r => r.status === 'pending').length} label="Pending" color="text-yellow-600" bgColor="bg-yellow-50" onClick={() => setFilterStatus('pending')} />
        <StatsCard icon={ShieldCheck} count={((stats?.byStatus?.supervisor_approved || 0) + (stats?.byStatus?.storekeeper_approved || 0)) || requests.filter(r => ['supervisor_approved', 'storekeeper_approved'].includes(r.status)).length} label="Awaiting Approval" color="text-sky-600" bgColor="bg-sky-50" onClick={() => setFilterStatus('supervisor_approved')} />
        <StatsCard icon={Wrench} count={stats?.byStatus?.issued ?? requests.filter(r => r.status === 'issued').length} label="Issued / Out" color="text-emerald-600" bgColor="bg-emerald-50" onClick={() => setFilterStatus('issued')} />
        <StatsCard icon={AlertTriangle} count={stats?.overdueCount ?? requests.filter(r => r.isOverdue).length} label="Overdue" color="text-red-600" bgColor="bg-red-50" subtext="!" onClick={() => setFilterStatus('all')} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search tools, WO#, or request#..." value={searchText} onChange={(e) => setSearchText(e.target.value)} className="pl-9" />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All Statuses</SelectItem><SelectItem value="pending">Pending</SelectItem><SelectItem value="supervisor_approved">Supervisor Approved</SelectItem><SelectItem value="storekeeper_approved">Store Approved</SelectItem><SelectItem value="issued">Issued</SelectItem><SelectItem value="pending_return">Pending Return</SelectItem><SelectItem value="returned">Returned</SelectItem></SelectContent>
        </Select>
        <Select value={filterUrgency} onValueChange={setFilterUrgency}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Urgency" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All Urgency</SelectItem><SelectItem value="low">Low</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="critical">Critical</SelectItem></SelectContent>
        </Select>
        {canViewAll && (
          <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
            <Button size="sm" variant={viewMode === 'all' ? 'default' : 'ghost'} className={`gap-1 h-8 ${viewMode === 'all' ? 'bg-background shadow-sm' : ''}`} onClick={() => setViewMode('all')}>
              <ClipboardList className="h-3 w-3" /> All Requests
            </Button>
            <Button size="sm" variant={viewMode === 'mine' ? 'default' : 'ghost'} className={`gap-1 h-8 ${viewMode === 'mine' ? 'bg-background shadow-sm' : ''}`} onClick={() => setViewMode('mine')}>
              <User className="h-3 w-3" /> My Requests
            </Button>
          </div>
        )}
        <ClearFiltersButton onClick={clearFilters} count={activeFilters} />
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {loading ? <LoadingSkeleton /> : filtered.length === 0 ? (
            <EmptyState icon={Wrench} title="No tool requests found" description="Create a new tool request to get started">
              {(user && (hasPermission('repair_tool_requests.create') || isAdmin())) && <Button onClick={() => { setCreateForm({ workOrderId: '', reason: '', notes: '', urgency: 'medium', items: [emptyItemRow()] }); setCreateOpen(true); }} className="gap-2"><Plus className="h-4 w-4" /> New Request</Button>}
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow className="bg-muted/50">
                  <TableHead className="w-[120px]">Request #</TableHead>
                  <TableHead className="min-w-[180px]">Tools</TableHead>
                  <TableHead className="w-[80px]">WO #</TableHead>
                  <TableHead className="w-[70px]">Total Qty</TableHead>
                  <TableHead className="w-[100px]">Fulfillment</TableHead>
                  <TableHead className="w-[150px]">Status</TableHead>
                  <TableHead className="w-[110px]">Age</TableHead>
                  <TableHead className="w-[100px] text-right">Actions</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {filtered.map((r, idx) => {
                    const ratio = getFulfillmentRatio(r);
                    const pct = ratio.requested > 0 ? Math.round((ratio.issued / ratio.requested) * 100) : 0;
                    return (
                    <TableRow key={r.id} className={`cursor-pointer hover:bg-muted/30 transition-colors ${idx % 2 === 0 ? '' : 'bg-muted/20'}`}
                      onClick={() => { setDetailItem(r); setDetailOpen(true); }}>
                      <TableCell>
                        <div className="font-mono text-xs font-medium">{r.requestNumber || '—'}</div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-sm truncate max-w-[220px]">{getToolNamesSummary(r)}</div>
                        <div className="text-xs text-muted-foreground">{getRequestItems(r).length} item{getRequestItems(r).length !== 1 ? 's' : ''}</div>
                      </TableCell>
                      <TableCell><Badge variant="outline" className="font-mono text-xs">{r.workOrder?.woNumber}</Badge></TableCell>
                      <TableCell className="text-center">
                        <span className="text-sm font-medium">{ratio.requested}</span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={pct} className="h-2 w-16" />
                          <span className="text-xs text-muted-foreground">{ratio.issued}/{ratio.requested}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <StatusBadge status={r.status} />
                          {r.urgency && <UrgencyBadge urgency={r.urgency} />}
                        </div>
                      </TableCell>
                      <TableCell><OverduePulse isOverdue={r.isOverdue} date={r.createdAt} /></TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7"><MoreHorizontal className="h-3.5 w-3.5" /></Button></DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => { setDetailItem(r); setDetailOpen(true); }}><Eye className="h-4 w-4 mr-2" /> View Details</DropdownMenuItem>
                              {r.status === 'pending' && canApproveAsSupervisor(r, user, 'repair_tool_requests.update') && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onClick={() => handleAction(r.id, 'supervisor_approve')}><CheckCircle2 className="h-4 w-4 mr-2 text-emerald-600" /> Approve</DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => { setRejectTarget({ id: r.id, action: 'supervisor_reject' }); setRejectOpen(true); }}><XCircle className="h-4 w-4 mr-2 text-red-500" /> Reject</DropdownMenuItem>
                                </>
                              )}
                              {r.status === 'supervisor_approved' && canApproveAsStore(user, 'repair_tool_requests.update') && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onClick={() => handleAction(r.id, 'storekeeper_approve')}><Warehouse className="h-4 w-4 mr-2 text-teal-600" /> Store Approve</DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => { setRejectTarget({ id: r.id, action: 'storekeeper_reject' }); setRejectOpen(true); }}><XCircle className="h-4 w-4 mr-2 text-red-500" /> Reject</DropdownMenuItem>
                                </>
                              )}
                              {r.status === 'storekeeper_approved' && canApproveAsStore(user, 'repair_tool_requests.update') && (
                                <DropdownMenuItem onClick={() => { setDetailItem(r); openIssueDialog(); }}><Wrench className="h-4 w-4 mr-2 text-emerald-600" /> Issue Tools</DropdownMenuItem>
                              )}
                              {hasOutstandingItems(r) && canActAsToolCustodian(r, user) && (
                                <DropdownMenuItem onClick={() => { setDetailItem(r); openReturnDialog(); }}><RotateCcw className="h-4 w-4 mr-2 text-amber-600" /> Return Tools</DropdownMenuItem>
                              )}
                              {hasOutstandingItems(r) && canTransferToolCustody(r, user) && (
                                <DropdownMenuItem onClick={() => { setDetailItem(r); openTransferDialog(); }}><ArrowRightLeft className="h-4 w-4 mr-2 text-sky-600" /> Transfer Tools</DropdownMenuItem>
                              )}
                              {r.status === 'pending' && (r.requestedById === user?.id || isAdmin()) && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setDetailItem(r); openEditForm(); }}><Pencil className="h-4 w-4 mr-2" /> Edit Request</DropdownMenuItem>
                                  <DropdownMenuItem className="text-red-600" onClick={(e) => { e.stopPropagation(); setDetailItem(r); setDeleteOpen(true); }}><Trash2 className="h-4 w-4 mr-2" /> Delete Request</DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Showing page {pagination.page} of {pagination.totalPages} ({pagination.total} total)</p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
            <span className="text-sm font-medium">{page} / {pagination.totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= pagination.totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>
      )}

      {/* ═══════ Detail Sheet ═══════ */}
      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="sm:max-w-xl w-full overflow-y-auto">
          {detailItem && (<>
            <SheetHeader className="mb-4">
              <div className="flex items-center gap-2 flex-wrap">
                <Wrench className="h-5 w-5 text-orange-600" />
                <SheetTitle>{detailItem.toolName}</SheetTitle>
                {detailItem.requestNumber && <Badge variant="outline" className="font-mono text-xs">{detailItem.requestNumber}</Badge>}
              </div>
              <SheetDescription className="flex items-center gap-2 flex-wrap">
                <span>WO: {detailItem.workOrder?.woNumber}</span>
                <StatusBadge status={detailItem.status} />
                {detailItem.urgency && <UrgencyBadge urgency={detailItem.urgency} />}
              </SheetDescription>
            </SheetHeader>
            <div className="px-4 pb-4">
              <Tabs defaultValue="details">
                <TabsList className="w-full"><TabsTrigger value="details" className="flex-1">Details</TabsTrigger><TabsTrigger value="timeline" className="flex-1">Timeline</TabsTrigger></TabsList>
                <TabsContent value="details" className="mt-4 space-y-4">

                  {/* ── Tool Items Section ── */}
                  <Card>
                    <CardHeader className="pb-2 pt-3 px-4">
                      <CardTitle className="text-sm font-medium">Tool Items ({getRequestItems(detailItem).length})</CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-3">
                      <div className="space-y-2 max-h-64 overflow-y-auto">
                        {getRequestItems(detailItem).map((item: any, idx: number) => (
                          <div key={item.id || idx} className="flex flex-col gap-1 p-2 bg-muted/30 rounded-lg text-sm">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="font-medium truncate">{item.toolName}</span>
                                {item.toolCode && <span className="text-xs text-muted-foreground font-mono">{item.toolCode}</span>}
                              </div>
                              <AvailabilityBadge status={item.availabilityStatus} />
                            </div>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                              <span>Requested: <strong className="text-foreground">{item.quantityRequested}</strong></span>
                              {item.quantityApproved != null && <span>Approved: <strong className="text-foreground">{item.quantityApproved}</strong></span>}
                              <span>Issued: <strong className="text-foreground">{item.quantityIssued}</strong></span>
                              {item.quantityReturned > 0 && <span>Returned: <strong className="text-foreground">{item.quantityReturned}</strong></span>}
                              {(item.quantityTransferred || 0) > 0 && <span className="text-sky-600">Transferred: <strong className="text-foreground">{item.quantityTransferred}</strong></span>}
                              {(item.pendingReturnQty || 0) > 0 && <span className="text-amber-600 font-medium">⏳ Pending Return: <strong className="text-foreground">{item.pendingReturnQty}</strong></span>}
                            </div>
                            {item.issueNotes && (
                              <div className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1 mt-1">
                                <Info className="h-3 w-3 inline mr-1" />{item.issueNotes}
                              </div>
                            )}
                            {/* Pending return condition and notes */}
                            {(item.pendingReturnQty || 0) > 0 && (
                              <div className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1 mt-1 space-y-0.5">
                                <div>Reported condition: <StatusBadge status={item.pendingReturnCondition || 'good'} /></div>
                                {item.pendingReturnNotes && <div>Notes: {item.pendingReturnNotes}</div>}
                              </div>
                            )}
                            {(item.conditionAtIssue || item.conditionAtReturn) && (
                              <div className="flex gap-3 text-xs mt-1">
                                {item.conditionAtIssue && <span>Condition at issue: <StatusBadge status={item.conditionAtIssue} /></span>}
                                {item.conditionAtReturn && <span>Condition at return: <StatusBadge status={item.conditionAtReturn} /></span>}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  <Separator />

                  {/* Request info */}
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label className="text-xs text-muted-foreground">Requested By</Label>
                      <div className="flex items-center gap-2 mt-1"><AvatarPlaceholder name={detailItem.requestedBy?.fullName || ''} /><span className="text-sm">{detailItem.requestedBy?.fullName}</span></div>
                    </div>
                    <div><Label className="text-xs text-muted-foreground">Created</Label><p className="text-sm mt-1">{format(new Date(detailItem.createdAt), 'MMM d, yyyy h:mm a')}</p></div>
                  </div>
                  <div><Label className="text-xs text-muted-foreground">Reason</Label><p className="text-sm mt-1 bg-muted/50 rounded-lg p-3">{detailItem.reason}</p></div>
                  {detailItem.notes && <div><Label className="text-xs text-muted-foreground">Notes</Label><p className="text-sm mt-1 bg-muted/50 rounded-lg p-3">{detailItem.notes}</p></div>}
                  {detailItem.rejectionReason && (
                    <div><Label className="text-xs text-muted-foreground">Rejection Reason</Label><p className="text-sm mt-1 bg-red-50 text-red-700 rounded-lg p-3">{detailItem.rejectionReason}</p></div>
                  )}

                  {/* ── Workflow Actions ── */}
                  {((detailItem.status === 'pending' && canApproveAsSupervisor(detailItem, user, 'repair_tool_requests.update')) ||
                    (detailItem.status === 'supervisor_approved' && canApproveAsStore(user, 'repair_tool_requests.update')) ||
                    (detailItem.status === 'storekeeper_approved' && canApproveAsStore(user, 'repair_tool_requests.update')) ||
                    (detailItem.status === 'pending_return' && canApproveAsStore(user, 'repair_tool_requests.update')) ||
                    (detailItem.status !== 'pending_return' && hasOutstandingItems(detailItem) && canActAsToolCustodian(detailItem, user))) && (<>
                    <Separator />
                    <div className="flex flex-wrap gap-2">
                      {detailItem.status === 'pending' && canApproveAsSupervisor(detailItem, user, 'repair_tool_requests.update') && (<>
                        <Button size="sm" className="gap-1 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => handleAction(detailItem.id, 'supervisor_approve')} disabled={submitting}><CheckCircle2 className="h-3.5 w-3.5" /> Approve</Button>
                        <Button size="sm" variant="destructive" onClick={() => { setRejectTarget({ id: detailItem.id, action: 'supervisor_reject' }); setRejectOpen(true); }} disabled={submitting}>Reject</Button>
                      </>)}
                      {detailItem.status === 'supervisor_approved' && canApproveAsStore(user, 'repair_tool_requests.update') && (<>
                        <Button size="sm" className="gap-1 bg-teal-600 hover:bg-teal-700 text-white" onClick={() => handleAction(detailItem.id, 'storekeeper_approve')} disabled={submitting}><Warehouse className="h-3.5 w-3.5" /> Store Approve</Button>
                        <Button size="sm" variant="destructive" onClick={() => { setRejectTarget({ id: detailItem.id, action: 'storekeeper_reject' }); setRejectOpen(true); }} disabled={submitting}>Reject</Button>
                      </>)}
                      {detailItem.status === 'storekeeper_approved' && canApproveAsStore(user, 'repair_tool_requests.update') && (
                        <Button size="sm" className="gap-1 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => { setDetailItem(detailItem); openIssueDialog(); }} disabled={submitting}><Wrench className="h-3.5 w-3.5" /> Issue Tools</Button>
                      )}
                      {/* ── Store Keeper Return Confirmation ── */}
                      {detailItem.status === 'pending_return' && canApproveAsStore(user, 'repair_tool_requests.update') && (
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" className="gap-1 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={async () => {
                            setSubmitting(true);
                            const res = await api.post(`/api/repairs/tool-requests/${detailItem.id}`, { action: 'storekeeper_confirm_return' });
                            if (res.success) {
                              toast.success('Return confirmed — tools updated in inventory');
                              if (res.warnings) res.warnings.forEach((w: string) => toast.warning(w));
                              const detailRes = await api.get(`/api/repairs/tool-requests/${detailItem.id}`);
                              if (detailRes.success) setDetailItem(detailRes.data);
                              fetchRequests();
                            } else {
                              toast.error(res.error || 'Failed to confirm return');
                            }
                            setSubmitting(false);
                          }} disabled={submitting}><CheckCircle2 className="h-3.5 w-3.5" /> Confirm Return</Button>
                          <Button size="sm" variant="destructive" onClick={() => { setRejectTarget({ id: detailItem.id, action: 'storekeeper_reject_return' }); setRejectOpen(true); }} disabled={submitting}><XCircle className="h-3.5 w-3.5" /> Reject Return</Button>
                        </div>
                      )}
                      {detailItem.status !== 'pending_return' && hasOutstandingItems(detailItem) && canActAsToolCustodian(detailItem, user) && (
                        <div className="flex gap-2">
                          <Button size="sm" className="gap-1 bg-amber-600 hover:bg-amber-700 text-white" onClick={() => { setDetailItem(detailItem); openReturnDialog(); }} disabled={submitting}><RotateCcw className="h-3.5 w-3.5" /> Return Tools</Button>
                          {canTransferToolCustody(detailItem, user) && (
                            <Button size="sm" className="gap-1 bg-sky-600 hover:bg-sky-700 text-white" onClick={() => { setDetailItem(detailItem); openTransferDialog(); }} disabled={submitting}><ArrowRightLeft className="h-3.5 w-3.5" /> Transfer Tools</Button>
                          )}
                        </div>
                      )}
                    </div>
                  </>)}

                  {/* Edit/Delete for owner */}
                  {detailItem.status === 'pending' && (detailItem.requestedById === user?.id || isAdmin()) && (<>
                    <Separator />
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" className="gap-1 border-sky-400 text-sky-700 hover:bg-sky-50" onClick={openEditForm} disabled={submitting}><Pencil className="h-3.5 w-3.5" /> Edit Request</Button>
                      <Button size="sm" variant="outline" className="gap-1 border-red-400 text-red-600 hover:bg-red-50" onClick={() => setDeleteOpen(true)} disabled={submitting}><Trash2 className="h-3.5 w-3.5" /> Delete Request</Button>
                    </div>
                  </>)}
                </TabsContent>
                <TabsContent value="timeline" className="mt-4">
                  <DetailTimeline events={[
                    { label: 'Request Created', date: detailItem.createdAt, user: detailItem.requestedBy?.fullName, status: 'active' },
                    { label: 'Supervisor Approval', date: detailItem.supervisorApprovedAt, user: detailItem.supervisorApprovedBy?.fullName, status: detailItem.status },
                    { label: 'Store Approval', date: detailItem.storekeeperApprovedAt, user: detailItem.storekeeperApprovedBy?.fullName, status: detailItem.status },
                    { label: 'Tools Issued', date: detailItem.issuedAt, user: detailItem.issuedBy?.fullName },
                    { label: 'Tools Returned', date: detailItem.returnedAt, user: detailItem.returnedBy?.fullName },
                  ].filter(e => e.date || e.status === 'active')} />
                </TabsContent>
              </Tabs>
            </div>
          </>)}
        </SheetContent>
      </Sheet>

      {/* ═══════ Create Dialog ═══════ */}
      <ResponsiveDialog open={createOpen} onOpenChange={setCreateOpen}>
        <div className="space-y-1.5 mb-4">
          <h2 className="text-lg font-semibold leading-none tracking-tight">New Tool Request</h2>
          <p className="text-sm text-muted-foreground">Request tools for a repair work order</p>
        </div>
        <div className="space-y-4">
          <div>
            <Label>Work Order *</Label>
            <AsyncSearchableSelect
              value={createForm.workOrderId}
              onValueChange={(v) => setCreateForm(f => ({ ...f, workOrderId: v }))}
              placeholder="Select work order..."
              searchPlaceholder="Search work orders..."
              fetchOptions={async () => {
                const res = await api.get('/api/work-orders?limit=999');
                if (res.success && Array.isArray(res.data)) return res.data.map((w: any) => ({ value: w.id, label: `${w.woNumber} — ${w.title}` }));
                return [];
              }}
            />
          </div>

          {/* Tool Items */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Tool Items *</Label>
              <Button type="button" variant="outline" size="sm" className="h-7 gap-1" onClick={addCreateItem}>
                <Plus className="h-3 w-3" /> Add Another Tool
              </Button>
            </div>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {createForm.items.map((item, idx) => (
                <ToolItemRowEditor key={idx} item={item} index={idx} onUpdate={updateCreateItem} onRemove={removeCreateItem} canRemove={createForm.items.length > 1} />
              ))}
            </div>
            {createForm.items.filter(i => !i.toolName.trim()).length > 0 && (
              <p className="text-xs text-red-500">Please select a tool for each item</p>
            )}
          </div>

          <div>
            <Label>Urgency</Label>
            <div className="flex gap-2 mt-1">
              {Object.entries(URGENCY_CONFIG).map(([key, cfg]) => (
                <button key={key} onClick={() => setCreateForm(f => ({ ...f, urgency: key }))}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border-2 text-xs font-medium transition-all ${createForm.urgency === key ? cfg.color + ' ring-2 ring-offset-1 ring-gray-300' : 'border-gray-200 text-muted-foreground hover:border-gray-300'}`}>
                  <span className={`h-2 w-2 rounded-full ${cfg.dotColor}`} />{cfg.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label>Reason * <span className="text-xs text-muted-foreground">(min 5 chars)</span></Label>
            <Textarea value={createForm.reason} onChange={(e) => setCreateForm(f => ({ ...f, reason: e.target.value }))} placeholder="Why are these tools needed?" rows={3} />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea value={createForm.notes} onChange={(e) => setCreateForm(f => ({ ...f, notes: e.target.value }))} placeholder="Additional information..." rows={2} />
          </div>
        </div>
        <div className="flex flex-col-reverse gap-2 mt-4 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button onClick={handleCreate} disabled={submitting} className="gap-2"><Send className="h-4 w-4" /> Submit Request</Button>
        </div>
      </ResponsiveDialog>

      {/* ═══════ Issue Tools Dialog ═══════ */}
      <ResponsiveDialog open={issueOpen} onOpenChange={setIssueOpen}>
        <div className="space-y-1.5 mb-4">
          <h2 className="text-lg font-semibold leading-none tracking-tight">Issue Tools</h2>
          <p className="text-sm text-muted-foreground">Specify quantity to issue for each tool item</p>
        </div>
        <div className="space-y-3 max-h-72 overflow-y-auto">
          {issueForm.map((item: any, idx: number) => (
            <div key={item.itemId} className="space-y-2 p-3 bg-muted/30 rounded-lg border">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-medium text-sm truncate">{item.toolName}</span>
                  {item.toolCode && <span className="text-xs text-muted-foreground font-mono">{item.toolCode}</span>}
                </div>
                <AvailabilityBadge status={item.availableQty >= item.quantityApproved ? 'available' : item.availableQty > 0 ? 'limited' : 'unavailable'} />
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span>Requested: {item.quantityRequested}</span>
                <span>Approved: {item.quantityApproved}</span>
                <span>In stock: {item.availableQty}</span>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1">
                  <Label className="text-xs">Qty to Issue</Label>
                  <Input type="number" min={0} max={Math.min(item.quantityApproved, item.availableQty)} value={item.quantityIssued}
                    onChange={e => {
                      const val = Math.max(0, Math.min(parseInt(e.target.value) || 0, item.quantityApproved, item.availableQty));
                      const newForm = [...issueForm];
                      newForm[idx] = { ...newForm[idx], quantityIssued: val };
                      setIssueForm(newForm);
                    }}
                    className="h-8" />
                </div>
                <div className="flex-1">
                  <Label className="text-xs">Notes (partial issue reason)</Label>
                  <Input value={item.issueNotes} placeholder="e.g. only 2 available..."
                    onChange={e => {
                      const newForm = [...issueForm];
                      newForm[idx] = { ...newForm[idx], issueNotes: e.target.value };
                      setIssueForm(newForm);
                    }}
                    className="h-8" />
                </div>
              </div>
              {item.quantityIssued < item.quantityApproved && item.quantityIssued > 0 && (
                <p className="text-xs text-amber-600">⚠ Partial issue: {item.quantityApproved - item.quantityIssued} will remain unissued</p>
              )}
            </div>
          ))}
        </div>
        <div className="flex flex-col-reverse gap-2 mt-4 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => setIssueOpen(false)}>Cancel</Button>
          <Button onClick={handleIssue} disabled={submitting} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"><Wrench className="h-4 w-4" /> Issue Tools</Button>
        </div>
      </ResponsiveDialog>

      {/* ═══════ Return Tools Dialog ═══════ */}
      <ResponsiveDialog open={returnItemsOpen} onOpenChange={setReturnItemsOpen}>
        <div className="space-y-1.5 mb-4">
          <h2 className="text-lg font-semibold leading-none tracking-tight">Return Tools</h2>
          <p className="text-sm text-muted-foreground">Specify quantity and condition for each tool. Remove items you don&apos;t want to return.</p>
        </div>
        <div className="space-y-3 max-h-72 overflow-y-auto">
          {returnItemsForm.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-4">No items to return. All items have been removed.</div>
          )}
          {returnItemsForm.map((item: any, idx: number) => (
            <div key={item.itemId} className="space-y-2 p-3 bg-muted/30 rounded-lg border">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm truncate flex-1">{item.toolName}</span>
                {item.toolCode && <span className="text-xs text-muted-foreground font-mono">{item.toolCode}</span>}
                <span className="text-xs text-muted-foreground">
                  {item.quantityAlreadyReturned > 0 ? (
                    <>Returned: {item.quantityAlreadyReturned} · Remaining: <strong>{item.quantityIssued - item.quantityAlreadyReturned}</strong></>
                  ) : (
                    <>Issued: {item.quantityIssued}</>
                  )}
                </span>
                <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500 hover:text-red-700 hover:bg-red-50 shrink-0" onClick={() => {
                  const newForm = returnItemsForm.filter((_, i) => i !== idx);
                  setReturnItemsForm(newForm);
                }}><X className="h-3.5 w-3.5" /></Button>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="w-full sm:w-28">
                  <Label className="text-xs">Qty to Return</Label>
                  <Input type="number" min={0} max={item.quantityIssued - item.quantityAlreadyReturned} value={item.quantityReturned}
                    onChange={e => {
                      const val = Math.max(0, Math.min(parseInt(e.target.value) || 0, item.quantityIssued - item.quantityAlreadyReturned));
                      const newForm = [...returnItemsForm];
                      newForm[idx] = { ...newForm[idx], quantityReturned: val };
                      setReturnItemsForm(newForm);
                    }}
                    className="h-8" />
                </div>
                <div className="flex-1">
                  <Label className="text-xs">Condition</Label>
                  <Select value={item.conditionAtReturn} onValueChange={v => {
                    const newForm = [...returnItemsForm];
                    newForm[idx] = { ...newForm[idx], conditionAtReturn: v };
                    setReturnItemsForm(newForm);
                  }}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">New/Excellent</SelectItem>
                      <SelectItem value="good">Good</SelectItem>
                      <SelectItem value="fair">Fair</SelectItem>
                      <SelectItem value="poor">Poor</SelectItem>
                      <SelectItem value="damaged">Damaged</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-xs">Return Notes</Label>
                <Input
                  value={item.notes || ''}
                  onChange={e => {
                    const newForm = [...returnItemsForm];
                    newForm[idx] = { ...newForm[idx], notes: e.target.value };
                    setReturnItemsForm(newForm);
                  }}
                  placeholder="Condition details, damage, missing parts, or handover notes"
                  className="h-8"
                />
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-col-reverse gap-2 mt-4 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => setReturnItemsOpen(false)}>Cancel</Button>
          <Button onClick={handleReturn} disabled={submitting || returnItemsForm.length === 0} className="gap-2 bg-amber-600 hover:bg-amber-700 text-white"><RotateCcw className="h-4 w-4" /> Return Tools</Button>
        </div>
      </ResponsiveDialog>

      {/* ═══════ Transfer Tools Dialog ═══════ */}
      <ResponsiveDialog open={transferDialogOpen} onOpenChange={setTransferDialogOpen}>
        <div className="space-y-1.5 mb-4">
          <h2 className="text-lg font-semibold leading-none tracking-tight">Transfer Tools</h2>
          <p className="text-sm text-muted-foreground">Select technician and reason for each tool. Remove items you don&apos;t want to transfer.</p>
        </div>
        <div className="space-y-3 max-h-72 overflow-y-auto">
          {transferForm.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-4">No items to transfer. All items have been removed.</div>
          )}
          {transferForm.map((item: any, idx: number) => (
            <div key={item.itemId} className="space-y-2 p-3 bg-sky-50/50 rounded-lg border border-sky-200">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm truncate flex-1">{item.toolName}</span>
                {item.toolCode && <span className="text-xs text-muted-foreground font-mono">{item.toolCode}</span>}
                <span className="text-xs text-muted-foreground">Available: {item.quantityToTransfer}</span>
                <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500 hover:text-red-700 hover:bg-red-50 shrink-0" onClick={() => {
                  const newForm = transferForm.filter((_, i) => i !== idx);
                  setTransferForm(newForm);
                }}><X className="h-3.5 w-3.5" /></Button>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="w-full sm:w-24">
                  <Label className="text-xs">Qty</Label>
                  <Input type="number" min={0} max={(item.quantityIssued || 1) - (item.quantityReturned || 0)} value={item.quantityToTransfer}
                    onChange={e => {
                      const val = Math.max(0, Math.min(parseInt(e.target.value) || 0, (item.quantityIssued || 1) - (item.quantityReturned || 0)));
                      const newForm = [...transferForm];
                      newForm[idx] = { ...newForm[idx], quantityToTransfer: val };
                      setTransferForm(newForm);
                    }}
                    className="h-8" />
                </div>
                <div className="flex-1">
                  <Label className="text-xs">Transfer To *</Label>
                  <AsyncSearchableSelect
                    value={item.toUserId}
                    onValueChange={v => {
                      const newForm = [...transferForm];
                      newForm[idx] = { ...newForm[idx], toUserId: v, toUserName: '' };
                      setTransferForm(newForm);
                    }}
                    placeholder="Search technician..."
                    searchPlaceholder="Search by name or username..."
                    fetchOptions={async (query) => {
                      if (!item.toolId) return [];
                      const params = new URLSearchParams({ toolId: item.toolId });
                      if (query.trim()) params.set('search', query.trim());
                      const res = await api.get(`/api/repairs/tool-transfers/candidates?${params.toString()}`);
                      const candidates = res.success && Array.isArray(res.data?.candidates) ? res.data.candidates : [];
                      return candidates.map((u: any) => ({
                        value: u.id,
                        label: `${u.fullName}${u.staffId ? ` [${u.staffId}]` : u.username ? ` (${u.username})` : ''}`,
                      }));
                    }}
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs">Reason *</Label>
                <Input
                  value={item.transferReason}
                  onChange={e => {
                    const newForm = [...transferForm];
                    newForm[idx] = { ...newForm[idx], transferReason: e.target.value };
                    setTransferForm(newForm);
                  }}
                  placeholder="Why is this tool being transferred?"
                  className="h-8 text-sm"
                />
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-col-reverse gap-2 mt-4 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => setTransferDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleTransfer} disabled={submitting || transferForm.length === 0} className="gap-2 bg-sky-600 hover:bg-sky-700 text-white"><ArrowRightLeft className="h-4 w-4" /> Transfer Tools</Button>
        </div>
      </ResponsiveDialog>

      <RejectDialog open={rejectOpen} onClose={() => { setRejectOpen(false); setRejectTarget(null); }} onConfirm={(reason) => { if (rejectTarget) handleAction(rejectTarget.id, rejectTarget.action, { notes: reason }); }} title={rejectTarget?.action === 'storekeeper_reject_return' ? 'Reject Tool Return' : 'Reject Tool Request'} />

      {/* ═══════ Edit Dialog ═══════ */}
      <ResponsiveDialog open={editOpen} onOpenChange={(v) => { if (!v) setEditOpen(false); }}>
        <div className="space-y-1.5 mb-4">
          <h2 className="text-lg font-semibold leading-none tracking-tight">Edit Tool Request</h2>
          <p className="text-sm text-muted-foreground">Modify your pending tool request</p>
        </div>
        <div className="space-y-4">
          {/* Tool Items */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Tool Items *</Label>
              <Button type="button" variant="outline" size="sm" className="h-7 gap-1" onClick={addEditItem}>
                <Plus className="h-3 w-3" /> Add Another Tool
              </Button>
            </div>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {editForm.items.map((item, idx) => (
                <ToolItemRowEditor key={idx} item={item} index={idx} onUpdate={updateEditItem} onRemove={removeEditItem} canRemove={editForm.items.length > 1} />
              ))}
            </div>
          </div>

          <div>
            <Label>Urgency</Label>
            <div className="flex gap-2 mt-1">
              {Object.entries(URGENCY_CONFIG).map(([key, cfg]) => (
                <button key={key} onClick={() => setEditForm(f => ({ ...f, urgency: key }))}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border-2 text-xs font-medium transition-all ${editForm.urgency === key ? cfg.color + ' ring-2 ring-offset-1 ring-gray-300' : 'border-gray-200 text-muted-foreground hover:border-gray-300'}`}>
                  <span className={`h-2 w-2 rounded-full ${cfg.dotColor}`} />{cfg.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label>Reason * <span className="text-xs text-muted-foreground">(min 5 chars)</span></Label>
            <Textarea value={editForm.reason} onChange={(e) => setEditForm(f => ({ ...f, reason: e.target.value }))} placeholder="Why are these tools needed?" rows={3} />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea value={editForm.notes} onChange={(e) => setEditForm(f => ({ ...f, notes: e.target.value }))} placeholder="Additional information..." rows={2} />
          </div>
        </div>
        <div className="flex flex-col-reverse gap-2 mt-4 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
          <Button onClick={handleEdit} disabled={submitting} className="gap-2"><Send className="h-4 w-4" /> Save Changes</Button>
        </div>
      </ResponsiveDialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Tool Request</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this tool request? This will also remove all tool items. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={submitting} className="gap-2"><Trash2 className="h-4 w-4" /> Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================================
// PAGE 3: TOOL TRANSFER REQUESTS
// ============================================================================

export function RepairToolTransfersPage() {
  const { user, hasPermission, isAdmin } = useAuthStore();
  const userRoleSlugs = (user?.roles || []).map(role => role.slug);
  const { pageParams } = useNavigationStore();
  const repairsEnabled = useModuleEnabled(MODULE_CODES.REPAIRS);
  const [transfers, setTransfers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any>(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<any>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [conditionOpen, setConditionOpen] = useState(false);
  const [conditionTarget, setConditionTarget] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<any>(null);
  const [createForm, setCreateForm] = useState({ toolId: '', toUserId: '', reason: '', notes: '' });

  // Auto-fill create form from pageParams (e.g., from RepairCompletion's "Transfer" button)
  useEffect(() => {
    if (pageParams?.toolId) {
      setCreateForm(prev => ({
        ...prev,
        toolId: pageParams.toolId,
        reason: `Transfer from WO completion — ${pageParams.toolName || 'tool'}`,
      }));
      setCreateOpen(true);
      // Clear pageParams after using
      const nav = useNavigationStore.getState();
      nav.navigate('repairs-tool-transfers', {});
    }
  }, [pageParams?.toolId]);

  const activeFilters = useMemo(() => { let c = 0; if (filterStatus !== 'all') c++; if (searchText) c++; return c; }, [filterStatus, searchText]);
  const clearFilters = () => { setFilterStatus('all'); setSearchText(''); setPage(1); };

  const fetchTransfers = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterStatus !== 'all') params.set('status', filterStatus);
    if (searchText) params.set('search', searchText);
    params.set('page', String(page));
    params.set('limit', '50');
    const [listRes, statsRes] = await Promise.all([
      api.get(`/api/repairs/tool-transfers?${params}`),
      api.get('/api/repairs/tool-transfers?stats=true'),
    ]);
    if (listRes.success) setTransfers(listRes.data || []); else toast.error(listRes.error || 'Failed');
    if (listRes.pagination) setPagination(listRes.pagination);
    if (statsRes.success) setStats(statsRes.data);
    setLoading(false);
  }, [filterStatus, searchText, page]);

  useEffect(() => { fetchTransfers(); }, [fetchTransfers]);

  const handleCreate = async () => {
    if (!createForm.toolId || !createForm.toUserId || !createForm.reason || createForm.reason.length < 5) {
      toast.error('Tool, receiving technician, and reason (min 5 chars) are required.'); return;
    }
    setSubmitting(true);
    const res = await api.post('/api/repairs/tool-transfers', createForm);
    if (res.success) {
      toast.success('Transfer request submitted');
      setCreateOpen(false);
      setCreateForm({ toolId: '', toUserId: '', reason: '', notes: '' });
      fetchTransfers();
    } else toast.error(res.error || 'Failed');
    setSubmitting(false);
  };

  const handleAction = async (id: string, action: string, extra?: Record<string, any>) => {
    setSubmitting(true);
    const res = await api.post(`/api/repairs/tool-transfers/${id}`, { action, ...extra });
    if (res.success) { toast.success('Action completed'); fetchTransfers(); if (detailOpen && detailItem?.id === id) setDetailOpen(false); }
    else toast.error(res.error || 'Failed');
    setSubmitting(false);
  };

  const filtered = useMemo(() => transfers.filter(t =>
    !searchText || t.tool?.name?.toLowerCase().includes(searchText.toLowerCase()) || t.fromUser?.fullName?.toLowerCase().includes(searchText.toLowerCase()) || t.toUser?.fullName?.toLowerCase().includes(searchText.toLowerCase())
  ), [transfers, searchText]);

  if (!repairsEnabled) {
    return (<div className="flex items-center justify-center h-96"><div className="text-center"><p className="text-muted-foreground">Repairs module is not active.</p><p className="text-sm text-muted-foreground mt-1">Enable it in Settings → Modules.</p></div></div>);
  }

  return (
    <div className="page-content">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-teal-100 rounded-xl"><ArrowRightLeft className="h-6 w-6 text-teal-700" /></div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold tracking-tight">Tool Transfers</h2>
              <Badge variant="secondary" className="font-mono">{transfers.length}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">Manage tool custody transfers between technicians</p>
          </div>
        </div>
        {(user && (hasPermission('repair_tool_transfers.create') || isAdmin())) && <Button onClick={() => setCreateOpen(true)} className="gap-2"><Plus className="h-4 w-4" /> New Transfer</Button>}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard icon={Clock} count={stats?.byStatus?.pending ?? transfers.filter(t => t.status === 'pending').length} label="Pending Review" color="text-yellow-600" bgColor="bg-yellow-50" onClick={() => { setFilterStatus('pending'); setPage(1); }} />
        <StatsCard icon={Handshake} count={stats?.byStatus?.storekeeper_approved ?? transfers.filter(t => t.status === 'storekeeper_approved').length} label="Awaiting Handover" color="text-sky-600" bgColor="bg-sky-50" onClick={() => { setFilterStatus('storekeeper_approved'); setPage(1); }} />
        <StatsCard icon={CheckCircle2} count={stats?.byStatus?.transferred ?? transfers.filter(t => t.status === 'transferred').length} label="Completed" color="text-emerald-600" bgColor="bg-emerald-50" onClick={() => { setFilterStatus('transferred'); setPage(1); }} />
        <StatsCard icon={XCircle} count={stats?.byStatus?.rejected ?? transfers.filter(t => t.status === 'rejected').length} label="Rejected" color="text-red-600" bgColor="bg-red-50" onClick={() => { setFilterStatus('rejected'); setPage(1); }} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search tools, users..." value={searchText} onChange={(e) => setSearchText(e.target.value)} className="pl-9" />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All Statuses</SelectItem><SelectItem value="pending">Pending</SelectItem><SelectItem value="storekeeper_approved">Awaiting Handover</SelectItem><SelectItem value="transferred">Transferred</SelectItem><SelectItem value="rejected">Rejected</SelectItem></SelectContent>
        </Select>
        <ClearFiltersButton onClick={clearFilters} count={activeFilters} />
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {loading ? <LoadingSkeleton /> : filtered.length === 0 ? (
            <EmptyState icon={ArrowRightLeft} title="No transfer requests found" description="Create a new transfer request to get started">
              {(user && (hasPermission('repair_tool_transfers.create') || isAdmin())) && <Button onClick={() => setCreateOpen(true)} className="gap-2"><Plus className="h-4 w-4" /> New Transfer</Button>}
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow className="bg-muted/50">
                  <TableHead className="w-[180px]">Tool</TableHead>
                  <TableHead className="w-[100px]">From</TableHead>
                  <TableHead className="w-[40px]"></TableHead>
                  <TableHead className="w-[100px]">To</TableHead>
                  <TableHead className="w-[160px]">Status</TableHead>
                  <TableHead className="w-[110px]">Time</TableHead>
                  <TableHead className="w-[130px] text-right">Actions</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {filtered.map((t, idx) => (
                    <TableRow key={t.id} className={`cursor-pointer hover:bg-muted/30 transition-colors ${idx % 2 === 0 ? '' : 'bg-muted/20'}`}
                      onClick={() => { setDetailItem(t); setDetailOpen(true); }}>
                      <TableCell>
                        <div className="font-medium text-sm">{t.tool?.name || 'Unknown Tool'}</div>
                        <div className="text-xs text-muted-foreground">{t.tool?.toolCode || ''}</div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <AvatarPlaceholder name={t.fromUser?.fullName || ''} />
                          <span className="text-sm truncate max-w-[70px]">{t.fromUser?.fullName}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center"><ArrowRightLeft className="h-4 w-4 text-muted-foreground" /></TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <AvatarPlaceholder name={t.toUser?.fullName || ''} />
                          <span className="text-sm truncate max-w-[70px]">{t.toUser?.fullName}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <StatusBadge status={t.status} />
                          <MiniPipeline stages={TRANSFER_STAGES} currentStatus={t.status} rejected={t.status === 'rejected'} />
                        </div>
                      </TableCell>
                      <TableCell><OverduePulse isOverdue={t.isOverdue} date={t.createdAt} /></TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                          {/* Approve / Reject — store keeper / tools shop attendant only */}
                          {canApproveAsStore(user) && (
                            <div className="flex items-center gap-1">
                              {t.status === 'pending' && (<>
                                <Button size="sm" className="h-7 gap-1 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => { setConditionTarget(t.id); setConditionOpen(true); }}><CheckCircle2 className="h-3.5 w-3.5" /> Approve</Button>
                                <TooltipProvider><Tooltip><TooltipTrigger asChild><Button size="sm" variant="ghost" className="h-7 px-2 text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => { setRejectTarget(t.id); setRejectOpen(true); }}><XCircle className="h-3.5 w-3.5" /></Button></TooltipTrigger><TooltipContent>Reject</TooltipContent></Tooltip></TooltipProvider>
                              </>)}
                            </div>
                          )}
                          {/* From User Accept Handover */}
                          {t.status === 'awaiting_handover' && user?.id === t.fromUserId && (
                            <Button size="sm" variant="outline" className="h-7 text-[10px] text-sky-600" onClick={() => handleAction(t.id, 'from_user_accept')}>Accept Handover</Button>
                          )}
                          {/* To User Accept Receipt */}
                          {t.status === 'awaiting_handover' && user?.id === t.toUserId && (
                            <Button size="sm" variant="outline" className="h-7 text-[10px] text-teal-600" onClick={() => handleAction(t.id, 'to_user_accept')}>Accept Receipt</Button>
                          )}
                          {/* Cancel — requester or supervisor */}
                          {t.status === 'pending' && (user?.id === t.requestedById || isAdmin() || userRoleSlugs.some(slug => ['maintenance_supervisor', 'maintenance_manager', 'plant_manager'].includes(slug))) && (
                            <Button size="sm" variant="ghost" className="h-7 text-[10px] text-red-500" onClick={() => { if (confirm('Cancel this transfer request?')) handleAction(t.id, 'cancel'); }}>Cancel</Button>
                          )}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7"><MoreHorizontal className="h-3.5 w-3.5" /></Button></DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => { setDetailItem(t); setDetailOpen(true); }}><Eye className="h-4 w-4 mr-2" /> View Details</DropdownMenuItem>
                              {t.status === 'awaiting_handover' && user?.id === t.toUserId && <DropdownMenuItem onClick={() => handleAction(t.id, 'to_user_accept')}><CheckCircle2 className="h-4 w-4 mr-2" /> Confirm Receipt</DropdownMenuItem>}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Showing page {pagination.page} of {pagination.totalPages} ({pagination.total} total)</p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
            <span className="text-sm font-medium">{page} / {pagination.totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= pagination.totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>
      )}

      {/* Detail Sheet */}
      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="sm:max-w-lg w-full overflow-y-auto">
          {detailItem && (<>
            <SheetHeader className="mb-4">
              <SheetTitle className="flex items-center gap-2"><ArrowRightLeft className="h-5 w-5 text-teal-600" /> Transfer: {detailItem.tool?.name}</SheetTitle>
              <SheetDescription>{detailItem.tool?.toolCode || ''}</SheetDescription>
            </SheetHeader>
            <div className="px-4 pb-4">
            <Tabs defaultValue="details">
              <TabsList className="w-full"><TabsTrigger value="details" className="flex-1">Details</TabsTrigger><TabsTrigger value="timeline" className="flex-1">Timeline</TabsTrigger></TabsList>
              <TabsContent value="details" className="mt-4 space-y-4">
                <div><Label className="text-xs text-muted-foreground">Status</Label><div className="mt-1"><StatusBadge status={detailItem.status} /></div></div>
                <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2"><AvatarPlaceholder name={detailItem.fromUser?.fullName || ''} size="md" /><div><p className="text-sm font-medium">{detailItem.fromUser?.fullName}</p><p className="text-xs text-muted-foreground">From</p></div></div>
                    <ArrowRightLeft className="h-5 w-5 text-muted-foreground" />
                    <div className="flex items-center gap-2"><div className="text-right"><p className="text-sm font-medium">{detailItem.toUser?.fullName}</p><p className="text-xs text-muted-foreground">To</p></div><AvatarPlaceholder name={detailItem.toUser?.fullName || ''} size="md" /></div>
                  </div>
                </div>
                <Separator />
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Handover Status</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <div className={`rounded-lg p-3 text-center ${detailItem.fromUserAcceptedAt ? 'bg-emerald-50 border border-emerald-200' : 'bg-muted/50'}`}>
                      <p className="text-xs text-muted-foreground">From User</p>
                      <p className={`text-sm font-medium ${detailItem.fromUserAcceptedAt ? 'text-emerald-600' : ''}`}>{detailItem.fromUserAcceptedAt ? 'Confirmed' : 'Pending'}</p>
                    </div>
                    <div className={`rounded-lg p-3 text-center ${detailItem.toUserAcceptedAt ? 'bg-emerald-50 border border-emerald-200' : 'bg-muted/50'}`}>
                      <p className="text-xs text-muted-foreground">To User</p>
                      <p className={`text-sm font-medium ${detailItem.toUserAcceptedAt ? 'text-emerald-600' : ''}`}>{detailItem.toUserAcceptedAt ? 'Confirmed' : 'Pending'}</p>
                    </div>
                  </div>
                </div>
                {detailItem.toolConditionAtTransfer && <div><Label className="text-xs text-muted-foreground">Condition at Transfer</Label><p className="mt-1"><StatusBadge status={detailItem.toolConditionAtTransfer} /></p></div>}
                <div><Label className="text-xs text-muted-foreground">Reason</Label><p className="text-sm mt-1 bg-muted/50 rounded-lg p-3">{detailItem.reason}</p></div>
                {detailItem.notes && <div><Label className="text-xs text-muted-foreground">Notes</Label><p className="text-sm mt-1 bg-muted/50 rounded-lg p-3">{detailItem.notes}</p></div>}
                {/* Approve / Reject — store keeper / tools shop attendant only */}
                {canApproveAsStore(user) && detailItem.status === 'pending' && (<>
                  <Separator />
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" className="gap-1 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => { setConditionTarget(detailItem.id); setConditionOpen(true); }} disabled={submitting}><CheckCircle2 className="h-3.5 w-3.5" /> Approve Transfer</Button>
                    <Button size="sm" variant="destructive" onClick={() => { setRejectTarget(detailItem.id); setRejectOpen(true); }} disabled={submitting}>Reject</Button>
                  </div>
                </>)}
                {/* From User Accept Handover */}
                {detailItem.status === 'awaiting_handover' && user?.id === detailItem.fromUserId && (<>
                  <Separator />
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" className="gap-1 text-sky-600" onClick={() => handleAction(detailItem.id, 'from_user_accept')} disabled={submitting}><Handshake className="h-3.5 w-3.5" /> Accept Handover</Button>
                  </div>
                </>)}
                {/* To User Accept Receipt */}
                {detailItem.status === 'awaiting_handover' && user?.id === detailItem.toUserId && (<>
                  <Separator />
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" className="gap-1 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => handleAction(detailItem.id, 'to_user_accept')} disabled={submitting}><CheckCircle2 className="h-3.5 w-3.5" /> Accept Receipt</Button>
                  </div>
                </>)}
                {/* Cancel — requester or supervisor */}
                {detailItem.status === 'pending' && (user?.id === detailItem.requestedById || isAdmin() || userRoleSlugs.some(slug => ['maintenance_supervisor', 'maintenance_manager', 'plant_manager'].includes(slug))) && (<>
                  <Separator />
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="ghost" className="text-red-500" onClick={() => { if (confirm('Cancel this transfer request?')) handleAction(detailItem.id, 'cancel'); }} disabled={submitting}>Cancel Transfer</Button>
                  </div>
                </>)}
              </TabsContent>
              <TabsContent value="timeline" className="mt-4">
                <DetailTimeline events={[
                  { label: 'Transfer Requested', date: detailItem.createdAt, user: detailItem.requestedBy?.fullName, status: 'active' },
                  { label: 'Storekeeper Approved', date: detailItem.storekeeperApprovedAt, user: detailItem.storekeeperApprovedBy?.fullName, status: detailItem.status },
                  { label: 'From User Confirmed', date: detailItem.fromUserAcceptedAt, user: detailItem.fromUser?.fullName },
                  { label: 'To User Confirmed', date: detailItem.toUserAcceptedAt, user: detailItem.toUser?.fullName },
                  { label: 'Transfer Complete', date: detailItem.transferredAt },
                ].filter(e => e.date || e.status === 'active')} />
              </TabsContent>
            </Tabs>
            </div>
          </>)}
        </SheetContent>
      </Sheet>

      {/* Create Dialog */}
      <ResponsiveDialog open={createOpen} onOpenChange={setCreateOpen}>
        
          <div className="space-y-1.5 mb-4"><h2 className="text-lg font-semibold leading-none tracking-tight">New Tool Transfer Request</h2><p className="text-sm text-muted-foreground">Request transfer of a tool to another technician</p></div>
          <div className="space-y-4">
            <div><Label>Tool *</Label><AsyncSearchableSelect value={createForm.toolId} onValueChange={(v) => setCreateForm(f => ({ ...f, toolId: v, toUserId: '' }))} placeholder="Select tool..." searchPlaceholder="Search tools..." fetchOptions={async () => { const res = await api.get('/api/tools?mode=lookup&limit=999'); if (res.success && Array.isArray(res.data)) return res.data.filter((t: any) => isAdmin() || t.assignedToId === user?.id).map((t: any) => ({ value: t.id, label: `${t.name} (${t.toolCode})` })); return []; }} /></div>
            <div className="space-y-2">
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">Current custodian is determined from the selected tool's custody record. Only eligible technicians in that tool's plant are listed below.</p>
              </div>
              <div>
                <Label>Transfer To *</Label>
                <AsyncSearchableSelect
                  value={createForm.toUserId}
                  onValueChange={(v) => setCreateForm(f => ({ ...f, toUserId: v }))}
                  placeholder={createForm.toolId ? 'Select receiving technician...' : 'Select a tool first...'}
                  searchPlaceholder="Search eligible technicians..."
                  fetchOptions={async (query) => {
                    if (!createForm.toolId) return [];
                    const params = new URLSearchParams({ toolId: createForm.toolId });
                    if (query.trim()) params.set('search', query.trim());
                    const res = await api.get(`/api/repairs/tool-transfers/candidates?${params.toString()}`);
                    const candidates = res.success && Array.isArray(res.data?.candidates) ? res.data.candidates : [];
                    return candidates.map((u: any) => ({
                      value: u.id,
                      label: `${u.fullName}${u.staffId ? ` [${u.staffId}]` : u.username ? ` (${u.username})` : ''}`,
                    }));
                  }}
                />
              </div>
            </div>
            <div><Label>Reason * <span className="text-xs text-muted-foreground">(min 5 chars)</span></Label><Textarea value={createForm.reason} onChange={(e) => setCreateForm({ ...createForm, reason: e.target.value })} placeholder="Why is this transfer needed?" rows={3} /></div>
            <div><Label>Notes</Label><Textarea value={createForm.notes} onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })} placeholder="Additional information..." rows={2} /></div>
          </div>
          <div className="flex flex-col-reverse gap-2 mt-4 sm:flex-row sm:justify-end"><Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button><Button onClick={handleCreate} disabled={submitting} className="gap-2"><Send className="h-4 w-4" /> Submit Transfer</Button></div>
        
      </ResponsiveDialog>

      <RejectDialog open={rejectOpen} onClose={() => { setRejectOpen(false); setRejectTarget(null); }} onConfirm={(reason) => { if (rejectTarget) handleAction(rejectTarget, 'storekeeper_reject', { notes: reason }); }} title="Reject Transfer Request" />
      <ConditionSelectDialog open={conditionOpen} onClose={() => { setConditionOpen(false); setConditionTarget(null); }} onConfirm={(condition) => { if (conditionTarget) handleAction(conditionTarget, 'storekeeper_approve', { toolConditionAtTransfer: condition }); }} />
    </div>
  );
}

// ============================================================================
// PAGE 4: DOWNTIME TRACKING
// ============================================================================

export function RepairDowntimePage() {
  const { user, hasPermission, isAdmin } = useAuthStore();
  const { pageParams } = useNavigationStore();
  const repairsEnabled = useModuleEnabled(MODULE_CODES.REPAIRS);
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  // Cache for asset lookup (used by AsyncSearchableSelect)
  const assetsCache = useRef<any[]>([]);
  const fetchAssets = useCallback(async () => {
    const res = await api.get('/api/assets?limit=500');
    if (res.success && Array.isArray(res.data)) {
      assetsCache.current = res.data;
      return res.data.map((a: any) => ({ value: a.id, label: a.name || a.assetTag }));
    }
    return [];
  }, []);

  const [createForm, setCreateForm] = useState({ workOrderId: '', assetName: '', assetId: '', downtimeStart: '', downtimeEnd: '', reason: '', category: 'unplanned', impactLevel: 'medium', productionLoss: '', notes: '' });
  // End downtime dialog
  const [endDowntimeTarget, setEndDowntimeTarget] = useState<string | null>(null);
  const [endDowntimeTime, setEndDowntimeTime] = useState('');
  // Filters
  const [searchText, setSearchText] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterImpact, setFilterImpact] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [workOrderIdFilter, setWorkOrderIdFilter] = useState('');
  const [pagination, setPagination] = useState<{ page: number; totalPages: number; total: number } | null>(null);

  // Auto-filter from WO detail
  useEffect(() => {
    if (pageParams?.workOrderId) {
      setWorkOrderIdFilter(pageParams.workOrderId);
    }
  }, []);

  const activeFilters = useMemo(() => {
    let c = 0;
    if (filterCategory !== 'all') c++;
    if (filterImpact !== 'all') c++;
    if (filterStatus !== 'all') c++;
    if (searchText) c++;
    return c;
  }, [filterCategory, filterImpact, filterStatus, searchText]);

  const clearFilters = () => { setFilterCategory('all'); setFilterImpact('all'); setFilterStatus('all'); setSearchText(''); setWorkOrderIdFilter(''); setPage(1); };

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterCategory !== 'all') params.set('category', filterCategory);
    if (filterImpact !== 'all') params.set('impactLevel', filterImpact);
    if (filterStatus !== 'all') params.set('status', filterStatus);
    if (workOrderIdFilter) params.set('workOrderId', workOrderIdFilter);
    if (searchText) params.set('search', searchText);
    params.set('page', String(page));
    params.set('limit', '20');
    const res = await api.get(`/api/repairs/downtime?${params}`);
    if (res.success) {
      setRecords(res.data || []);
      if (res.pagination) setPagination(res.pagination);
    } else {
      toast.error(res.error || 'Failed to load');
    }
    setLoading(false);
  }, [filterCategory, filterImpact, filterStatus, page, workOrderIdFilter, searchText]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  const handleCreate = async () => {
    if (!createForm.workOrderId || !createForm.assetName || !createForm.downtimeStart || !createForm.reason) { toast.error('Required fields missing'); return; }
    const res = await api.post('/api/repairs/downtime', {
      ...createForm,
      downtimeEnd: createForm.downtimeEnd || undefined,
      productionLoss: createForm.productionLoss ? parseFloat(createForm.productionLoss) : undefined,
    });
    if (res.success) { toast.success('Downtime recorded'); setCreateOpen(false); setCreateForm({ workOrderId: '', assetName: '', assetId: '', downtimeStart: '', downtimeEnd: '', reason: '', category: 'unplanned', impactLevel: 'medium', productionLoss: '', notes: '' }); fetchRecords(); }
    else toast.error(res.error || 'Failed');
  };

  const handleEndDowntime = async (recordId: string) => {
    setEndDowntimeTarget(recordId);
    setEndDowntimeTime(new Date().toISOString().slice(0, 16));
  };

  const handleEndDowntimeConfirm = async () => {
    if (!endDowntimeTarget || !endDowntimeTime) return;
    const res = await api.put(`/api/repairs/downtime/${endDowntimeTarget}`, { downtimeEnd: endDowntimeTime });
    if (res.success) { toast.success('Downtime ended'); fetchRecords(); }
    else toast.error(res.error || 'Failed');
    setEndDowntimeTarget(null);
  };

  const handleDelete = async (id: string) => {
    const res = await api.delete(`/api/repairs/downtime/${id}`);
    if (res.success) { toast.success('Deleted'); fetchRecords(); }
    else toast.error(res.error || 'Failed');
  };

  const totalMinutes = records.reduce((sum: number, r: any) => sum + (r.durationMinutes || 0), 0);

  if (!repairsEnabled) {
    return (<div className="flex items-center justify-center h-96"><div className="text-center"><p className="text-muted-foreground">Repairs module is not active.</p><p className="text-sm text-muted-foreground mt-1">Enable it in Settings → Modules.</p></div></div>);
  }

  return (
    <div className="page-content">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-red-100 rounded-xl"><Timer className="h-6 w-6 text-red-600" /></div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold tracking-tight">Downtime Tracking</h2>
              <Badge variant="secondary" className="font-mono">{pagination?.total ?? records.length}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">Track equipment downtime related to repair work orders</p>
          </div>
        </div>
        {(user && (hasPermission('work_orders.update') || hasPermission('work_orders.create') || isAdmin())) && <Button onClick={() => setCreateOpen(true)} className="gap-2"><Plus className="h-4 w-4" /> Log Downtime</Button>}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard icon={Activity} count={records.filter((r: any) => !r.downtimeEnd).length} label="Ongoing" color="text-red-600" bgColor="bg-red-50" onClick={() => { setFilterStatus('ongoing'); setPage(1); }} />
        <StatsCard icon={CheckCircle2} count={records.filter((r: any) => !!r.downtimeEnd).length} label="Completed" color="text-emerald-600" bgColor="bg-emerald-50" onClick={() => { setFilterStatus('completed'); setPage(1); }} />
        <StatsCard icon={AlertTriangle} count={records.filter((r: any) => r.category === 'unplanned').length} label="Unplanned" color="text-orange-600" bgColor="bg-orange-50" onClick={() => { setFilterCategory('unplanned'); setPage(1); }} />
        <StatsCard icon={Clock} count={formatDurationFromMinutes(totalMinutes)} label="Total Downtime" color="text-blue-600" bgColor="bg-blue-50" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search asset name or WO#..." value={searchText} onChange={(e) => { setSearchText(e.target.value); setPage(1); }} className="pl-9" />
        </div>
        <Select value={filterCategory} onValueChange={(v) => { setFilterCategory(v); setPage(1); }}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            <SelectItem value="planned">Planned</SelectItem>
            <SelectItem value="unplanned">Unplanned</SelectItem>
            <SelectItem value="partial">Partial</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterImpact} onValueChange={(v) => { setFilterImpact(v); setPage(1); }}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Impact" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Impact</SelectItem>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={(v) => { setFilterStatus(v); setPage(1); }}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="ongoing">Ongoing</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>
        <ClearFiltersButton onClick={clearFilters} count={activeFilters} />
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {loading ? <LoadingSkeleton /> : records.length === 0 ? (
            <EmptyState icon={Timer} title="No downtime records" description="Log downtime events for repair work orders">
              {(user && (hasPermission('work_orders.update') || hasPermission('work_orders.create') || isAdmin())) && <Button onClick={() => setCreateOpen(true)} className="gap-2"><Plus className="h-4 w-4" /> Log Downtime</Button>}
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Asset</TableHead>
                    <TableHead>WO #</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Impact</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="w-16"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.map((r: any, idx: number) => (
                    <TableRow key={r.id} className={`${idx % 2 === 0 ? '' : 'bg-muted/20'}`}>
                      <TableCell>
                        <div className="font-medium text-sm">{r.assetName}</div>
                      </TableCell>
                      <TableCell><Badge variant="outline" className="font-mono text-xs">{r.workOrder?.woNumber}</Badge></TableCell>
                      <TableCell><StatusBadge status={r.category} /></TableCell>
                      <TableCell><PriorityBadge priority={r.impactLevel} /></TableCell>
                      <TableCell>
                        <div className="font-medium text-sm">{r.durationMinutes ? `${r.durationMinutes.toFixed(0)} min` : <span className="text-red-600">Ongoing</span>}</div>
                        <div className="text-xs text-muted-foreground">{r.downtimeStart ? format(new Date(r.downtimeStart), 'MMM d HH:mm') : ''}</div>
                      </TableCell>
                      <TableCell className="text-sm max-w-48 truncate">{r.reason}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7"><MoreHorizontal className="h-3.5 w-3.5" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {!r.downtimeEnd && (<DropdownMenuItem onClick={() => handleEndDowntime(r.id)}><Timer className="h-4 w-4 mr-2" /> End Downtime</DropdownMenuItem>)}
                            {(hasPermission('work_orders.update') || isAdmin()) && <DropdownMenuItem onClick={() => handleDelete(r.id)} className="text-red-600"><Ban className="h-4 w-4 mr-2" /> Delete</DropdownMenuItem>}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Showing page {pagination.page} of {pagination.totalPages} ({pagination.total} total)</p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
            <span className="text-sm font-medium">{page} / {pagination.totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= pagination.totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>
      )}

      <ResponsiveDialog open={createOpen} onOpenChange={setCreateOpen}>
        
          <div className="space-y-1.5 mb-4"><h2 className="text-lg font-semibold leading-none tracking-tight">Log Downtime</h2></div>
          <div className="space-y-4">
            <div><Label>Work Order ID *</Label><AsyncSearchableSelect
                value={createForm.workOrderId}
                onValueChange={(v) => setCreateForm(f => ({ ...f, workOrderId: v }))}
                placeholder="Select work order..."
                searchPlaceholder="Search work orders..."
                fetchOptions={async () => {
                  const res = await api.get('/api/work-orders?limit=999');
                  if (res.success && Array.isArray(res.data)) return res.data.map((w: any) => ({ value: w.id, label: `${w.woNumber} — ${w.title}` }));
                  return [];
                }}
              /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Asset Name *</Label><AsyncSearchableSelect value={createForm.assetId} onValueChange={(v) => { const asset = assetsCache.current.find((a: any) => a.id === v); setCreateForm(f => ({ ...f, assetId: v, assetName: asset ? (asset.name || asset.assetTag) : '' })); }} placeholder="Search assets..." searchPlaceholder="Search by name or tag..." fetchOptions={fetchAssets} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <DateTimePicker label="Start Time *" value={createForm.downtimeStart || undefined} onChange={v => setCreateForm(f => ({ ...f, downtimeStart: v || '' }))} />
              <DateTimePicker label="End Time" value={createForm.downtimeEnd || undefined} onChange={v => setCreateForm(f => ({ ...f, downtimeEnd: v || '' }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Category</Label>
                <Select value={createForm.category} onValueChange={(v) => setCreateForm({ ...createForm, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="unplanned">Unplanned</SelectItem><SelectItem value="planned">Planned</SelectItem><SelectItem value="partial">Partial</SelectItem></SelectContent>
                </Select>
              </div>
              <div><Label>Impact Level</Label>
                <Select value={createForm.impactLevel} onValueChange={(v) => setCreateForm({ ...createForm, impactLevel: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="critical">Critical</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Production Loss (₵)</Label><Input type="number" step="0.01" value={createForm.productionLoss} onChange={(e) => setCreateForm({ ...createForm, productionLoss: e.target.value })} /></div>
            <div><Label>Reason *</Label><Textarea value={createForm.reason} onChange={(e) => setCreateForm({ ...createForm, reason: e.target.value })} /></div>
          </div>
          <div className="flex flex-col-reverse gap-2 mt-4 sm:flex-row sm:justify-end"><Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button><Button onClick={handleCreate}>Save</Button></div>
        
      </ResponsiveDialog>

      {/* End Downtime Dialog */}
      <ResponsiveDialog open={!!endDowntimeTarget} onOpenChange={(open) => { if (!open) setEndDowntimeTarget(null); }}>
        
          <div className="space-y-1.5 mb-4"><h2 className="text-lg font-semibold leading-none tracking-tight">End Downtime</h2><p className="text-sm text-muted-foreground">Set the end time for this downtime event.</p></div>
          <div className="space-y-4">
            <DateTimePicker label="End Time *" value={endDowntimeTime || undefined} onChange={v => setEndDowntimeTime(v || '')} />
            <div className="flex flex-col-reverse gap-2 mt-4 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => setEndDowntimeTarget(null)}>Cancel</Button>
              <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleEndDowntimeConfirm}>End Downtime</Button>
            </div>
          </div>
        
      </ResponsiveDialog>
    </div>
  );
}

// ============================================================================
// PAGE 5: REPAIR COMPLETION & CLOSURE
// ============================================================================

// ============================================================================
// Sub-component: Flexible tool & material return/transfer on WO completion
// ============================================================================
// Two separate modals: Return (tools + materials) and Transfer (tools only)
// Each modal has a Remove (X) button per item to exclude items from the action.
// ============================================================================

interface ReturnTransferItem {
  id: string;
  type: 'tool' | 'material';
  name: string;
  code: string;
  issuedQty: number;
  returnedQty: number;
  transferredQty?: number;
  remainingQty: number;
  unit: string;
  requestId: string;
  lineItemId?: string;
  toolId?: string;
  declaredConsumedQty?: number | null;
  declaredWastedQty?: number | null;
  declaredReturnQty?: number | null;
  pendingStoreVerification?: boolean;
}

function ToolMaterialReturnPrompt({ workOrderId }: { workOrderId: string }) {
  const { user, isAdmin } = useAuthStore();
  const [allItems, setAllItems] = useState<ReturnTransferItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Return modal
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnItems, setReturnItems] = useState<(ReturnTransferItem & { qtyReturn: number; qtyConsumed: number; qtyWasted: number; condition: string; notes: string })[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  // Transfer modal
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferItems, setTransferItems] = useState<(ReturnTransferItem & { qtyTransfer: number; toUserId: string; toUserName: string; transferReason: string })[]>([]);

  // Fetch all outstanding tools and materials
  useEffect(() => {
    if (!workOrderId) return;
    setLoading(true);
    Promise.all([
      api.get(`/api/repairs/tool-requests?workOrderId=${workOrderId}&limit=999`),
      api.get(`/api/repairs/material-requests?workOrderId=${workOrderId}&limit=999`),
    ]).then(([toolRes, matRes]) => {
      const rows: ReturnTransferItem[] = [];

      if (toolRes.success && toolRes.data) {
        for (const tr of toolRes.data as any[]) {
          if (!['issued', 'pending_return'].includes(tr.status)) continue;
          if (tr.items && tr.items.length > 0) {
            for (const item of tr.items) {
              const issued = item.quantityIssued || 0;
              const returned = item.quantityReturned || 0;
              const xfer = item.quantityTransferred || 0;
              const remaining = issued - returned - xfer;
              if (remaining <= 0) continue;
              rows.push({ id: `${tr.id}-${item.id}`, type: 'tool', name: item.toolName || item.tool?.name || 'Unknown Tool', code: item.toolCode || item.tool?.toolCode || '', issuedQty: issued, returnedQty: returned, transferredQty: xfer, remainingQty: remaining, unit: 'pcs', requestId: tr.id, lineItemId: item.id, toolId: item.toolId || tr.toolId || '', pendingStoreVerification: tr.status === 'pending_return' });
            }
          } else {
            const issued = tr.quantityIssued || (tr.tool ? 1 : 0);
            const returned = tr.quantityReturned || 0;
            const remaining = issued - returned;
            if (remaining <= 0) continue;
            rows.push({ id: tr.id, type: 'tool', name: tr.toolName || tr.tool?.name || 'Unknown Tool', code: tr.tool?.toolCode || '', issuedQty: issued, returnedQty: returned, remainingQty: remaining, unit: 'pcs', requestId: tr.id, toolId: tr.toolId || '', pendingStoreVerification: tr.status === 'pending_return' });
          }
        }
      }

      if (matRes.success && matRes.data) {
        for (const mr of matRes.data as any[]) {
          if (!['issued', 'partially_returned', 'fully_returned'].includes(mr.status)) continue;
          const issued = mr.quantityIssued || 0;
          const returned = mr.quantityReturned || 0;
          const remaining = Math.max(0, issued - returned);
          if (issued <= 0) continue;
          rows.push({
            id: mr.id,
            type: 'material',
            name: mr.itemName,
            code: mr.item?.itemCode || '',
            issuedQty: issued,
            returnedQty: returned,
            remainingQty: remaining,
            unit: mr.unit || 'each',
            requestId: mr.id,
            declaredConsumedQty: mr.declaredConsumedQty,
            declaredWastedQty: mr.declaredWastedQty,
            declaredReturnQty: mr.declaredReturnQty,
            pendingStoreVerification: !!mr.usageDeclaredAt,
          });
        }
      }

      setAllItems(rows);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [workOrderId, refreshKey]);

  const toolItems = allItems.filter(i => i.type === 'tool');
  const actionableToolItems = toolItems.filter(i => !i.pendingStoreVerification);
  const actionableReturnItems = allItems.filter(i => i.type === 'material' || !i.pendingStoreVerification);
  const totalOutstanding = allItems.length;
  const hasTools = actionableToolItems.length > 0;
  const hasReturnActions = actionableReturnItems.length > 0;

  // ── Open Return modal ──
  const openReturn = () => {
    setReturnItems(actionableReturnItems.map(item => {
      const qtyConsumed = Number(item.declaredConsumedQty || 0);
      const qtyWasted = Number(item.declaredWastedQty || 0);
      const qtyReturn = item.type === 'material'
        ? Number(item.declaredReturnQty ?? 0)
        : item.remainingQty;
      return {
        ...item,
        qtyReturn,
        qtyConsumed,
        qtyWasted,
        condition: 'good' as string,
        notes: '',
      };
    }));
    setReturnOpen(true);
  };

  // ── Open Transfer modal ──
  const openTransfer = () => {
    setTransferItems(actionableToolItems.map(item => ({
      ...item,
      qtyTransfer: item.remainingQty,
      toUserId: '',
      toUserName: '',
      transferReason: '',
    })));
    setTransferOpen(true);
  };

  // ── Remove from return list ──
  const removeReturnItem = (id: string) => {
    setReturnItems(prev => prev.filter(i => i.id !== id));
  };

  // ── Remove from transfer list ──
  const removeTransferItem = (id: string) => {
    setTransferItems(prev => prev.filter(i => i.id !== id));
  };

  // ── Update return item ──
  const updateReturnItem = (id: string, patch: Record<string, any>) => {
    setReturnItems(prev => prev.map(item => item.id === id ? { ...item, ...patch } : item));
  };

  // ── Update transfer item ──
  const updateTransferItem = (id: string, patch: Record<string, any>) => {
    setTransferItems(prev => prev.map(item => item.id === id ? { ...item, ...patch } : item));
  };

  // ── Submit returns ──
  const handleReturnSubmit = async () => {
    const activeItems = returnItems.filter(i => i.type === 'material' || i.qtyReturn > 0);
    if (activeItems.length === 0) {
      toast.error('No tool returns or material declarations to submit');
      return;
    }
    setSubmitting(true);
    let errors: string[] = [];

    // Process tool returns grouped by requestId
    const toolReturnMap = new Map<string, { itemId?: string; qtyReturn: number; condition: string; notes?: string }[]>();
    for (const item of activeItems) {
      if (item.type !== 'tool') continue;
      const arr = toolReturnMap.get(item.requestId) || [];
      arr.push({ itemId: item.lineItemId, qtyReturn: item.qtyReturn, condition: item.condition, notes: item.notes?.trim() || undefined });
      toolReturnMap.set(item.requestId, arr);
    }

    // Process material returns
    const matReturnMap = new Map<string, { qtyReturn: number; qtyConsumed: number; qtyWasted: number; issuedQty: number }>();
    for (const item of activeItems) {
      if (item.type !== 'material') continue;
      const accounted = item.qtyConsumed + item.qtyWasted + item.qtyReturn;
      if (Math.abs(accounted - item.issuedQty) > 0.001) {
        errors.push(`${item.name}: used + wasted + to return must equal issued quantity (${item.issuedQty})`);
        continue;
      }
      matReturnMap.set(item.requestId, { qtyReturn: item.qtyReturn, qtyConsumed: item.qtyConsumed, qtyWasted: item.qtyWasted, issuedQty: item.issuedQty });
    }

    // Execute tool returns
    for (const [requestId, returns] of toolReturnMap) {
      try {
        const detailRes = await api.get(`/api/repairs/tool-requests/${requestId}`);
        if (!detailRes.success) { errors.push(`Tool return failed: ${detailRes.error}`); continue; }
        const detail = detailRes.data;
        const payload: Record<string, any> = { action: 'return' };
        if (detail.items && detail.items.length > 0) {
          payload.returnedItems = returns.map(r => ({ itemId: r.itemId, quantityReturned: r.qtyReturn, conditionAtReturn: r.condition, notes: r.notes }));
        } else {
          payload.toolConditionAtReturn = returns[0]?.condition || 'good';
        }
        const res = await api.post(`/api/repairs/tool-requests/${requestId}`, payload);
        if (!res.success) errors.push(res.error || `Failed to return tool request`);
        else if (res.warnings) res.warnings.forEach((w: string) => toast.warning(w));
      } catch (e: any) { errors.push(`Tool return error: ${e.message}`); }
    }

    // Submit technician material usage declarations. This does not credit stock;
    // the store must verify the physical return and perform final reconciliation.
    for (const [requestId, { qtyReturn, qtyConsumed, qtyWasted }] of matReturnMap) {
      try {
        const res = await api.post(`/api/repairs/material-requests/${requestId}`, {
          action: 'declare_usage',
          consumedQty: qtyConsumed,
          wastedQty: qtyWasted,
          returnQty: qtyReturn,
          notes: 'Declared by technician during work-order completion',
        });
        if (!res.success) errors.push(res.error || `Failed to declare material usage`);
      } catch (e: any) { errors.push(`Material declaration error: ${e.message}`); }
    }

    if (errors.length === 0) {
      toast.success('Submitted — tool returns and material declarations are awaiting store verification');
      setReturnOpen(false);
      setRefreshKey(k => k + 1);
    } else {
      errors.forEach(e => toast.error(e));
    }
    setSubmitting(false);
  };

  // ── Submit transfers ──
  const handleTransferSubmit = async () => {
    const activeItems = transferItems.filter(i => i.qtyTransfer > 0);
    if (activeItems.length === 0) {
      toast.error('No items to transfer');
      return;
    }
    for (const item of activeItems) {
      if (!item.toUserId) {
        toast.error(`Select a receiving technician for "${item.name}"`);
        return;
      }
      if (!item.transferReason || item.transferReason.length < 5) {
        toast.error(`Enter a reason for transferring "${item.name}" (min 5 chars)`);
        return;
      }
    }
    setSubmitting(true);
    let errors: string[] = [];
    for (const item of activeItems) {
      try {
        const res = await api.post('/api/repairs/tool-transfers', {
          toolId: item.toolId,
          toUserId: item.toUserId,
          reason: item.transferReason,
          notes: `WO completion transfer: ${item.qtyTransfer}x ${item.name}`,
        });
        if (!res.success) errors.push(res.error || `Failed to transfer "${item.name}"`);
        else toast.success(`Transfer request submitted for "${item.name}"`);
      } catch (e: any) { errors.push(`Transfer error: ${e.message}`); }
    }
    if (errors.length === 0) {
      toast.success('All transfers processed successfully');
      setTransferOpen(false);
      // Track transferred items locally (pending store approval)
      setAllItems(prev => prev.map(item => {
        const transferredItem = activeItems.find(ai => ai.id === item.id);
        if (transferredItem && transferredItem.qtyTransfer > 0) {
          return { ...item, transferredQty: (item.transferredQty || 0) + transferredItem.qtyTransfer, remainingQty: item.remainingQty - transferredItem.qtyTransfer };
        }
        return item;
      }).filter(i => i.remainingQty > 0));
    } else {
      errors.forEach(e => toast.error(e));
    }
    setSubmitting(false);
  };

  if (loading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Checking outstanding items...</div>;

  if (totalOutstanding === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 rounded-lg p-3 border border-emerald-200">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        <span>All tool custody and material reconciliation obligations are settled. Work order is ready for closure.</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2 text-sm text-amber-700">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span><strong>{totalOutstanding} outstanding item(s)</strong> — return or transfer tools, and declare material usage/return for store verification.</span>
      </div>

      {/* Items summary */}
      <div className="space-y-2">
        {allItems.map(item => (
          <div key={item.id} className="flex items-center gap-2 p-2 rounded-md bg-muted/30 border text-sm">
            <div className={`h-6 w-6 rounded flex items-center justify-center shrink-0 ${item.type === 'tool' ? 'bg-orange-100 text-orange-700' : 'bg-amber-100 text-amber-700'}`}>
              {item.type === 'tool' ? <Wrench className="h-3 w-3" /> : <Package className="h-3 w-3" />}
            </div>
            <span className="font-medium truncate flex-1">{item.name}</span>
            {item.code && <span className="text-xs font-mono text-muted-foreground">{item.code}</span>}
            <span className="text-xs text-muted-foreground whitespace-nowrap">{item.type === 'material' ? 'Issued' : 'Remaining'}: <strong>{item.type === 'material' ? item.issuedQty : item.remainingQty}</strong></span>
            {item.pendingStoreVerification && <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">Awaiting Store Verification</Badge>}
            {(item.returnedQty > 0 || (item.transferredQty || 0) > 0) && (
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                (Returned: {item.returnedQty}{(item.transferredQty || 0) > 0 ? ` · Transferred: ${item.transferredQty}` : ''})
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-2">
        {hasReturnActions && (
          <Button variant="outline" className="gap-2 bg-amber-600 hover:bg-amber-700 text-white" onClick={openReturn}>
            <RotateCcw className="h-4 w-4" /> Return Tools / Declare Materials
          </Button>
        )}
        {hasTools && (
          <Button variant="outline" className="gap-2 bg-sky-600 hover:bg-sky-700 text-white" onClick={openTransfer}>
            <ArrowRightLeft className="h-4 w-4" /> Transfer Tools ({actionableToolItems.length})
          </Button>
        )}
      </div>

      {/* ═══════ Return Modal ═══════ */}
      <ResponsiveDialog open={returnOpen} onOpenChange={setReturnOpen}>
        <div className="space-y-1.5 mb-4">
          <h2 className="text-lg font-semibold leading-none tracking-tight">Settle Tools &amp; Materials</h2>
          <p className="text-sm text-muted-foreground">For tools, submit the physical return and condition. For materials, declare Used + Wasted/Damaged + To Return; the store will verify and reconcile.</p>
        </div>
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {returnItems.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-4">No items remaining. All items have been removed.</div>
          )}
          {returnItems.map(item => (
            <div key={item.id} className="space-y-2 p-3 bg-muted/30 rounded-lg border">
              <div className="flex items-center gap-2">
                <div className={`h-6 w-6 rounded flex items-center justify-center shrink-0 ${item.type === 'tool' ? 'bg-orange-100 text-orange-700' : 'bg-amber-100 text-amber-700'}`}>
                  {item.type === 'tool' ? <Wrench className="h-3 w-3" /> : <Package className="h-3 w-3" />}
                </div>
                <span className="font-medium text-sm truncate flex-1">{item.name}</span>
                {item.code && <span className="text-xs font-mono text-muted-foreground">{item.code}</span>}
                <span className="text-xs text-muted-foreground">Available: {item.remainingQty}</span>
                <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500 hover:text-red-700 hover:bg-red-50 shrink-0" onClick={() => removeReturnItem(item.id)}><X className="h-3.5 w-3.5" /></Button>
              </div>
              {item.type === 'tool' ? (
                <>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <div className="w-full sm:w-28">
                      <Label className="text-xs">Qty to Return</Label>
                      <Input type="number" min={0} max={item.remainingQty} value={item.qtyReturn}
                        onChange={e => updateReturnItem(item.id, { qtyReturn: Math.max(0, Math.min(parseInt(e.target.value) || 0, item.remainingQty)) })}
                        className="h-8" />
                    </div>
                    <div className="flex-1">
                      <Label className="text-xs">Condition</Label>
                      <Select value={item.condition} onValueChange={v => updateReturnItem(item.id, { condition: v })}>
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="good">Good — ready for reissue</SelectItem>
                          <SelectItem value="fair">Fair — minor wear</SelectItem>
                          <SelectItem value="poor">Poor — needs service</SelectItem>
                          <SelectItem value="damaged">Damaged — needs repair</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Return Notes</Label>
                    <Input
                      value={item.notes || ''}
                      onChange={e => updateReturnItem(item.id, { notes: e.target.value })}
                      placeholder="Condition details, damage, missing parts, or handover notes"
                      className="h-8"
                    />
                  </div>
                </>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div>
                    <Label className="text-xs">Used</Label>
                    <Input type="number" min={0} max={item.issuedQty} value={item.qtyConsumed}
                      onChange={e => updateReturnItem(item.id, { qtyConsumed: Math.max(0, Math.min(parseFloat(e.target.value) || 0, item.issuedQty)) })}
                      className="h-8" />
                  </div>
                  <div>
                    <Label className="text-xs">Wasted / Damaged</Label>
                    <Input type="number" min={0} max={item.issuedQty} value={item.qtyWasted}
                      onChange={e => updateReturnItem(item.id, { qtyWasted: Math.max(0, Math.min(parseFloat(e.target.value) || 0, item.issuedQty)) })}
                      className="h-8" />
                  </div>
                  <div>
                    <Label className="text-xs">To Return</Label>
                    <Input type="number" min={0} max={item.issuedQty} value={item.qtyReturn}
                      onChange={e => updateReturnItem(item.id, { qtyReturn: Math.max(0, Math.min(parseFloat(e.target.value) || 0, item.issuedQty)) })}
                      className="h-8" />
                  </div>
                  <div className="sm:col-span-3 text-[11px] text-muted-foreground">
                    Accounted: <strong>{item.qtyConsumed + item.qtyWasted + item.qtyReturn}</strong> / Issued: <strong>{item.issuedQty}</strong>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="flex flex-col-reverse gap-2 mt-4 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => setReturnOpen(false)}>Cancel</Button>
          <Button onClick={handleReturnSubmit} disabled={submitting || returnItems.length === 0} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            {submitting ? 'Processing...' : 'Submit Returns / Declarations'}
          </Button>
        </div>
      </ResponsiveDialog>

      {/* ═══════ Transfer Modal ═══════ */}
      <ResponsiveDialog open={transferOpen} onOpenChange={setTransferOpen}>
        <div className="space-y-1.5 mb-4">
          <h2 className="text-lg font-semibold leading-none tracking-tight">Transfer Tools</h2>
          <p className="text-sm text-muted-foreground">Select a receiving technician and reason for each tool. Click the X button to remove items you don&apos;t want to transfer.</p>
        </div>
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {transferItems.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-4">No tools remaining. All items have been removed.</div>
          )}
          {transferItems.map(item => (
            <div key={item.id} className="space-y-2 p-3 bg-sky-50/50 rounded-lg border border-sky-200">
              <div className="flex items-center gap-2">
                <div className="h-6 w-6 rounded flex items-center justify-center shrink-0 bg-orange-100 text-orange-700">
                  <Wrench className="h-3 w-3" />
                </div>
                <span className="font-medium text-sm truncate flex-1">{item.name}</span>
                {item.code && <span className="text-xs font-mono text-muted-foreground">{item.code}</span>}
                <span className="text-xs text-muted-foreground">Available: {item.remainingQty}</span>
                <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500 hover:text-red-700 hover:bg-red-50 shrink-0" onClick={() => removeTransferItem(item.id)}><X className="h-3.5 w-3.5" /></Button>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="w-full sm:w-24">
                  <Label className="text-xs">Qty</Label>
                  <Input type="number" min={0} max={item.remainingQty} value={item.qtyTransfer}
                    onChange={e => updateTransferItem(item.id, { qtyTransfer: Math.max(0, Math.min(parseInt(e.target.value) || 0, item.remainingQty)) })}
                    className="h-8" />
                </div>
                <div className="flex-1">
                  <Label className="text-xs">Transfer To *</Label>
                  <AsyncSearchableSelect
                    value={item.toUserId}
                    onValueChange={v => updateTransferItem(item.id, { toUserId: v, toUserName: '' })}
                    placeholder="Search technician..."
                    searchPlaceholder="Search by name or username..."
                    fetchOptions={async (query) => {
                      if (!item.toolId) return [];
                      const params = new URLSearchParams({ toolId: item.toolId });
                      if (query.trim()) params.set('search', query.trim());
                      const res = await api.get(`/api/repairs/tool-transfers/candidates?${params.toString()}`);
                      const candidates = res.success && Array.isArray(res.data?.candidates) ? res.data.candidates : [];
                      return candidates.map((u: any) => ({
                        value: u.id,
                        label: `${u.fullName}${u.staffId ? ` [${u.staffId}]` : u.username ? ` (${u.username})` : ''}`,
                      }));
                    }}
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs">Reason *</Label>
                <Input
                  value={item.transferReason}
                  onChange={e => updateTransferItem(item.id, { transferReason: e.target.value })}
                  placeholder="Why is this tool being transferred?"
                  className="h-8 text-sm"
                />
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-col-reverse gap-2 mt-4 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => setTransferOpen(false)}>Cancel</Button>
          <Button onClick={handleTransferSubmit} disabled={submitting || transferItems.length === 0} className="gap-2 bg-sky-600 hover:bg-sky-700 text-white">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRightLeft className="h-4 w-4" />}
            {submitting ? 'Processing...' : `Transfer ${transferItems.filter(i => i.qtyTransfer > 0).length} Tool(s)`}
          </Button>
        </div>
      </ResponsiveDialog>
    </div>
  );
}

export function RepairCompletionPage() {
  const { user } = useAuthStore();
  const { pageParams } = useNavigationStore();
  const repairsEnabled = useModuleEnabled(MODULE_CODES.REPAIRS);
  const [woId, setWoId] = useState('');
  const [completion, setCompletion] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ completionNotes: '', findings: '', rootCause: '', correctiveAction: '', closureNotes: '' });
  // Rework reason dialog
  const [reworkDialogOpen, setReworkDialogOpen] = useState(false);
  const [reworkReasonValue, setReworkReasonValue] = useState('');

  // Component/part selection
  const [availableComponents, setAvailableComponents] = useState<any[]>([]);
  const [selectedComponentIds, setSelectedComponentIds] = useState<string[]>([]);
  const [componentSearch, setComponentSearch] = useState('');
  const [componentsLoading, setComponentsLoading] = useState(false);

  // Auto-load WO from pageParams (e.g. navigating from WO detail)
  useEffect(() => {
    if (pageParams?.workOrderId && !woId) {
      setWoId(pageParams.workOrderId);
    }
  }, []);

  const filteredComponents = useMemo(() => {
    if (!componentSearch) return availableComponents;
    const q = componentSearch.toLowerCase();
    return availableComponents.filter((c: any) =>
      c.name?.toLowerCase().includes(q) || c.componentCode?.toLowerCase().includes(q)
    );
  }, [availableComponents, componentSearch]);

  const fetchCompletion = useCallback(async () => {
    if (!woId) return;
    setLoading(true);
    const res = await api.get(`/api/repairs/completion/${woId}`);
    if (res.success) setCompletion(res.data);
    else setCompletion(null);
    setLoading(false);
  }, [woId]);

  // Auto-fetch when woId changes (handles both manual selection and pageParams auto-load)
  useEffect(() => {
    if (woId) fetchCompletion();
  }, [woId, fetchCompletion]);

  // Fetch available components when assetId is known
  useEffect(() => {
    const assetId = completion?.workOrder?.assetId;
    if (!assetId) return;
    (async () => {
      setComponentsLoading(true);
      const res = await api.get(`/api/component-registry?assetId=${assetId}`);
      if (res.success && Array.isArray(res.data)) {
        setAvailableComponents(res.data);
      } else {
        setAvailableComponents([]);
      }
      setComponentsLoading(false);
    })();
  }, [completion?.workOrder?.assetId]);

  // Fetch already-linked components for this WO
  useEffect(() => {
    if (!woId) return;
    (async () => {
      const res = await api.get(`/api/work-orders/${woId}/components`);
      if (res.success && Array.isArray(res.data)) {
        setSelectedComponentIds(res.data.map((c: any) => c.componentRegistry?.id || c.componentRegistryId || c.id));
      }
    })();
  }, [woId]);

  const handleSubmit = async (action: string) => {
    if (!woId) return;
    setSubmitting(true);
    const res = await api.post(`/api/repairs/completion/${woId}`, {
      action,
      completionNotes: form.completionNotes || undefined,
      findings: form.findings || undefined,
      rootCause: form.rootCause || undefined,
      correctiveAction: form.correctiveAction || undefined,
      closureNotes: form.closureNotes || undefined,
      ...(action === 'supervisor_request_rework' ? { reworkReason: reworkReasonValue } : {}),
      ...(action === 'supervisor_approve' ? { supervisorReviewNotes: form.completionNotes } : {}),
    });
    if (res.success) {
      toast.success('Action completed');
      // Save linked components
      if (woId && selectedComponentIds.length >= 0) {
        await api.put(`/api/work-orders/${woId}/components`, { componentIds: selectedComponentIds });
      }
      fetchCompletion();
    } else toast.error(res.error || 'Failed');
    setSubmitting(false);
  };

  if (!repairsEnabled) {
    return (<div className="flex items-center justify-center h-96"><div className="text-center"><p className="text-muted-foreground">Repairs module is not active.</p><p className="text-sm text-muted-foreground mt-1">Enable it in Settings → Modules.</p></div></div>);
  }

  return (
    <div className="page-content">
      <div>
        <h2 className="text-2xl font-bold flex items-center gap-2"><CheckCircle2 className="h-6 w-6 text-green-600" /> Work Order Completion & Closure</h2>
        <p className="text-muted-foreground">Submit completion, supervisor review, and planner final closure</p>
      </div>

      <Card>
        <CardContent className="p-4 flex gap-3">
          <div className="flex-1">
            <AsyncSearchableSelect
              value={woId}
              onValueChange={setWoId}
              placeholder="Search work orders..."
              searchPlaceholder="Search by WO number or title..."
              fetchOptions={async () => {
                const res = await api.get('/api/work-orders?limit=999');
                if (res.success && res.data) {
                  return res.data.map((w: any) => ({
                    value: w.id,
                    label: `${w.woNumber} — ${w.title}`,
                  }));
                }
                return [];
              }}
            />
          </div>
          <Button onClick={fetchCompletion} disabled={!woId || loading}>Load</Button>
        </CardContent>
      </Card>

      {loading && <LoadingSkeleton />}

      {completion && (
        <div className="grid gap-6">
          {/* WO Info */}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2">{completion.workOrder?.woNumber} — {completion.workOrder?.title}</CardTitle><CardDescription>Status: {completion.workOrder?.status}</CardDescription></CardHeader>
            <CardContent className="grid md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <div><Label className="text-muted-foreground">Supervisor Status</Label><div className="mt-1"><StatusBadge status={completion.supervisorStatus} /></div></div>
                {completion.supervisorApprovedAt && <div><Label className="text-muted-foreground">Approved By</Label><div className="mt-1 text-sm">{completion.supervisorApprovedBy?.fullName} — {formatDistanceToNow(new Date(completion.supervisorApprovedAt), { addSuffix: true })}</div></div>}
                {completion.reworkCount > 0 && <div className="text-orange-600"><AlertTriangle className="h-4 w-4 inline mr-1" /> Rework Count: {completion.reworkCount}</div>}
                {completion.reworkReason && <div className="bg-red-50 border border-red-200 rounded p-2 text-sm text-red-700"><strong>Rework Reason:</strong> {completion.reworkReason}</div>}
              </div>
              <div className="space-y-3">
                <div><Label className="text-muted-foreground">Planner Status</Label><div className="mt-1"><StatusBadge status={completion.plannerStatus} /></div></div>
                {completion.plannerClosedAt && <div><Label className="text-muted-foreground">Closed By</Label><div className="mt-1 text-sm">{completion.plannerClosedBy?.fullName} — {formatDistanceToNow(new Date(completion.plannerClosedAt), { addSuffix: true })}</div></div>}
              </div>
            </CardContent>
          </Card>

          {/* Completion Form */}
          <Card>
            <CardHeader><CardTitle>Completion Details</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className='space-y-2'>
                <Label className='text-sm font-medium'>Parts/Components Worked On</Label>
                <Input
                  placeholder='Search components...'
                  value={componentSearch}
                  onChange={e => setComponentSearch(e.target.value)}
                  className='max-w-sm'
                />
                <div className='border rounded-lg max-h-64 overflow-y-auto p-2 space-y-1'>
                  {componentsLoading ? (
                    <div className='text-sm text-muted-foreground p-2'>Loading components...</div>
                  ) : filteredComponents.length === 0 ? (
                    <div className='text-sm text-muted-foreground p-2'>No components registered for this machine</div>
                  ) : (
                    filteredComponents.map((comp: any) => (
                      <label key={comp.id} className='flex items-center gap-2 p-1.5 rounded hover:bg-muted/50 cursor-pointer'>
                        <input
                          type='checkbox'
                          checked={selectedComponentIds.includes(comp.id)}
                          onChange={() => {
                            setSelectedComponentIds(prev =>
                              prev.includes(comp.id) ? prev.filter(id => id !== comp.id) : [...prev, comp.id]
                            );
                          }}
                          className='rounded border-muted-foreground/30'
                        />
                        <div className='flex-1 min-w-0'>
                          <div className='text-sm font-medium truncate'>{comp.name}</div>
                          <div className='text-xs text-muted-foreground'>
                            {comp.componentCode}{comp.componentType ? ` · ${comp.componentType}` : ''}
                          </div>
                        </div>
                        <Badge variant={comp.criticality === 'critical' ? 'destructive' : comp.criticality === 'high' ? 'default' : 'secondary'} className='text-[10px]'>
                          {comp.criticality}
                        </Badge>
                      </label>
                    ))
                  )}
                </div>
                {selectedComponentIds.length > 0 && (
                  <p className='text-xs text-muted-foreground'>{selectedComponentIds.length} component(s) selected</p>
                )}
              </div>
              <div><Label>Completion Notes</Label><Textarea value={form.completionNotes} onChange={(e) => setForm({ ...form, completionNotes: e.target.value })} placeholder="Describe work completed..." rows={3} /></div>
              <div className="grid md:grid-cols-2 gap-4">
                <div><Label>Findings</Label><Textarea value={form.findings} onChange={(e) => setForm({ ...form, findings: e.target.value })} /></div>
                <div><Label>Root Cause</Label><Textarea value={form.rootCause} onChange={(e) => setForm({ ...form, rootCause: e.target.value })} /></div>
              </div>
              <div><Label>Corrective Action</Label><Textarea value={form.correctiveAction} onChange={(e) => setForm({ ...form, correctiveAction: e.target.value })} /></div>
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Labor, material/tool costs and downtime are calculated automatically from approved time logs, custody/reconciliation records and downtime entries.
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="rounded-md border bg-muted/30 p-3"><p className="text-xs text-muted-foreground">Labor Hours</p><p className="mt-1 font-semibold">{Number(completion.totalLaborHours || 0).toFixed(2)}</p></div>
                  <div className="rounded-md border bg-muted/30 p-3"><p className="text-xs text-muted-foreground">Material Cost</p><p className="mt-1 font-semibold">{formatCurrency(completion.totalMaterialCost || 0)}</p></div>
                  <div className="rounded-md border bg-muted/30 p-3"><p className="text-xs text-muted-foreground">Tool Cost</p><p className="mt-1 font-semibold">{formatCurrency(completion.totalToolCost || 0)}</p></div>
                  <div className="rounded-md border bg-muted/30 p-3"><p className="text-xs text-muted-foreground">Downtime</p><p className="mt-1 font-semibold">{Number(completion.totalDowntimeMinutes || 0).toFixed(0)} min</p></div>
                </div>
              </div>

              {/* Actions */}
              <Separator />
              <div className="flex flex-wrap gap-3">
                {((completion.supervisorStatus === 'pending_review' && completion.workOrder?.status !== 'completed') || completion.supervisorStatus === 'rework_requested') && canSubmitCompletion(completion, user) && (
                  <Button onClick={() => handleSubmit('submit')} disabled={submitting}><CheckCircle2 className="h-4 w-4 mr-2" /> {completion.supervisorStatus === 'rework_requested' ? 'Resubmit Completion' : 'Submit Completion'}</Button>
                )}
                {completion.supervisorStatus === 'pending_review' && completion.workOrder?.status === 'completed' && canReviewCompletion(completion, user) && (
                  <Button variant="destructive" onClick={() => { setReworkDialogOpen(true); }} disabled={submitting}><RotateCcw className="h-4 w-4 mr-2" /> Request Rework</Button>
                )}
                {completion.supervisorStatus === 'pending_review' && completion.workOrder?.status === 'completed' && canReviewCompletion(completion, user) && (
                  <Button variant="outline" className="border-green-600 text-green-600" onClick={() => handleSubmit('supervisor_approve')} disabled={submitting}><ShieldCheck className="h-4 w-4 mr-2" /> Supervisor Approve</Button>
                )}
                {completion.supervisorStatus === 'approved' && completion.plannerStatus === 'pending_closure' && canCloseCompletion(completion, user) && (                  <>
                    <div><Label>Closure Notes</Label><Textarea value={form.closureNotes} onChange={(e) => setForm({ ...form, closureNotes: e.target.value })} /></div>
                    <Button className="bg-gray-800" onClick={() => handleSubmit('planner_close')} disabled={submitting}><CheckCircle2 className="h-4 w-4 mr-2" /> Planner Close WO</Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Outstanding Tools & Materials Return Reminder */}
          <Card className="border-amber-200 bg-amber-50/30">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><PackageCheck className="h-4 w-4 text-amber-600" />Outstanding Tools & Materials</CardTitle>
              <CardDescription className="text-xs">Return or transfer tools and reusable materials before closing this work order</CardDescription>
            </CardHeader>
            <CardContent>
              <ToolMaterialReturnPrompt workOrderId={woId} />
            </CardContent>
          </Card>
        </div>
      )}

      {woId && !loading && !completion && (
        <EmptyState icon={ClipboardList} title="No completion record found" description="Enter a valid Work Order ID to load completion data" />
      )}

      {/* Rework Reason Dialog */}
      <ResponsiveDialog open={reworkDialogOpen} onOpenChange={setReworkDialogOpen}>
        
          <div className="space-y-1.5 mb-4"><h2 className="text-lg font-semibold leading-none tracking-tight">Request Rework</h2><p className="text-sm text-muted-foreground">Please provide a reason for requesting rework.</p></div>
          <Textarea value={reworkReasonValue} onChange={e => setReworkReasonValue(e.target.value)} placeholder="Rework reason..." rows={3} />
          <div className="flex flex-col-reverse gap-2 mt-4 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => { setReworkDialogOpen(false); setReworkReasonValue(''); }}>Cancel</Button>
            <Button variant="destructive" disabled={!reworkReasonValue.trim() || submitting} onClick={() => { setReworkDialogOpen(false); handleSubmit('supervisor_request_rework'); }}>Request Rework</Button>
          </div>
        
      </ResponsiveDialog>
    </div>
  );
}

// ============================================================================
// PAGE 6: REPAIR ANALYTICS KPIs
// ============================================================================

export function RepairAnalyticsPage() {
  const repairsEnabled = useModuleEnabled(MODULE_CODES.REPAIRS);
  const [kpi, setKpi] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [reconReport, setReconReport] = useState<any>(null);
  const [reconLoading, setReconLoading] = useState(false);
  const [reconPage, setReconPage] = useState(1);

  // New report state
  const [enterpriseReport, setEnterpriseReport] = useState<any>(null);
  const [enterpriseLoading, setEnterpriseLoading] = useState(false);
  const [downtimeReport, setDowntimeReport] = useState<any>(null);
  const [downtimeLoading, setDowntimeLoading] = useState(false);
  const [repeatReport, setRepeatReport] = useState<any>(null);
  const [repeatLoading, setRepeatLoading] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [pdfLoading, setPdfLoading] = useState(false);
  const [activeAnalyticsTab, setActiveAnalyticsTab] = useState('overview');

  useEffect(() => {
    (async () => {
      const res = await api.get('/api/repairs/kpi');
      if (res.success) setKpi(res.data);
      setLoading(false);
    })();
  }, []);

  const fetchReconReport = useCallback(async (p: number = 1) => {
    setReconLoading(true);
    const res = await api.get(`/api/repairs/material-requests/reconciliation-report?page=${p}&limit=10`);
    if (res.success) {
      setReconReport(res.data);
      setReconPage(p);
    } else {
      toast.error(res.error || 'Failed to load reconciliation report');
    }
    setReconLoading(false);
  }, []);

  const fetchEnterpriseReport = useCallback(async () => {
    setEnterpriseLoading(true);
    const params = new URLSearchParams();
    if (dateFrom) params.set('from', dateFrom);
    if (dateTo) params.set('to', dateTo);
    const res = await api.get(`/api/reports/enterprise?${params}`);
    if (res.success) setEnterpriseReport(res.data);
    else toast.error(res.error || 'Failed to load enterprise report');
    setEnterpriseLoading(false);
  }, [dateFrom, dateTo]);

  const fetchDowntimeReport = useCallback(async () => {
    setDowntimeLoading(true);
    const params = new URLSearchParams();
    if (dateFrom) params.set('from', dateFrom);
    if (dateTo) params.set('to', dateTo);
    const res = await api.get(`/api/reports/downtime?${params}`);
    if (res.success) setDowntimeReport(res.data);
    else toast.error(res.error || 'Failed to load downtime report');
    setDowntimeLoading(false);
  }, [dateFrom, dateTo]);

  const fetchRepeatReport = useCallback(async () => {
    setRepeatLoading(true);
    const params = new URLSearchParams();
    if (dateFrom) params.set('from', dateFrom);
    if (dateTo) params.set('to', dateTo);
    const res = await api.get(`/api/reports/repeat-failures?${params}`);
    if (res.success) setRepeatReport(res.data);
    else toast.error(res.error || 'Failed to load repeat failure report');
    setRepeatLoading(false);
  }, [dateFrom, dateTo]);

  const downloadPDF = useCallback(async () => {
    try {
      setPdfLoading(true);
      const params = new URLSearchParams();
      if (dateFrom) params.set('from', dateFrom);
      if (dateTo) params.set('to', dateTo);
      if (activeAnalyticsTab && activeAnalyticsTab !== 'overview') params.set('reportType', activeAnalyticsTab);
      params.set('format', 'pdf');

      const response = await api.getRaw(`/api/repairs/reports?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to generate PDF');

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `repairs-analytics-${activeAnalyticsTab}-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('PDF report downloaded');
    } catch {
      toast.error('Failed to download PDF report');
    } finally {
      setPdfLoading(false);
    }
  }, [dateFrom, dateTo, activeAnalyticsTab]);

  if (!repairsEnabled) {
    return (<div className="flex items-center justify-center h-96"><div className="text-center"><p className="text-muted-foreground">Repairs module is not active.</p><p className="text-sm text-muted-foreground mt-1">Enable it in Settings → Modules.</p></div></div>);
  }

  if (loading) return <LoadingSkeleton />;

  return (
    <div className="page-content">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2"><BarChart3 className="h-6 w-6 text-blue-600" /> Repairs Analytics</h2>
          <p className="text-muted-foreground">Key performance indicators and enterprise reports for the repairs module</p>
        </div>
        <div className="flex items-center gap-2">
          <DateRangePicker from={dateFrom || undefined} to={dateTo || undefined} onChange={(f, t) => { setDateFrom(f || ''); setDateTo(t || ''); }} />
          {(dateFrom || dateTo) && (
            <Button variant="ghost" size="sm" onClick={() => { setDateFrom(''); setDateTo(''); }} className="h-9"><X className="h-3.5 w-3.5" /></Button>
          )}
          <Button variant="outline" size="sm" onClick={downloadPDF} disabled={pdfLoading} className="gap-1.5">
            {pdfLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
            Download PDF
          </Button>
        </div>
      </div>

      {!kpi ? (
        <EmptyState icon={BarChart3} title="No data available" />
      ) : (
        <Tabs value={activeAnalyticsTab} onValueChange={setActiveAnalyticsTab}>
          <TabsList className="flex-wrap">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="backlog" className="gap-1"><Clock className="h-3.5 w-3.5" /> Backlog</TabsTrigger>
            <TabsTrigger value="downtime-deep" className="gap-1"><Timer className="h-3.5 w-3.5" /> Downtime</TabsTrigger>
            <TabsTrigger value="repeat-failures" className="gap-1"><AlertTriangle className="h-3.5 w-3.5" /> Repeat Failures</TabsTrigger>
            <TabsTrigger value="reconciliation" className="gap-1"><ClipboardList className="h-3.5 w-3.5" /> Reconciliation</TabsTrigger>
          </TabsList>

          {/* ===== OVERVIEW TAB ===== */}
          <TabsContent value="overview" className="mt-4 space-y-6">
          <Card>
            <CardHeader><CardTitle>Work Order Metrics</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="text-center p-3 bg-blue-50 rounded-lg"><p className="text-3xl font-bold text-blue-700">{kpi.workOrders?.total}</p><p className="text-xs text-muted-foreground">Total WOs</p></div>
                <div className="text-center p-3 bg-green-50 rounded-lg"><p className="text-3xl font-bold text-green-700">{kpi.workOrders?.completionRate}%</p><p className="text-xs text-muted-foreground">Completion Rate</p></div>
                <div className="text-center p-3 bg-orange-50 rounded-lg"><p className="text-3xl font-bold text-orange-700">{kpi.workOrders?.inProgress}</p><p className="text-xs text-muted-foreground">In Progress</p></div>
                <div className="text-center p-3 bg-red-50 rounded-lg"><p className="text-3xl font-bold text-red-700">{kpi.workOrders?.overdue}</p><p className="text-xs text-muted-foreground">Overdue</p></div>
                <div className="text-center p-3 bg-purple-50 rounded-lg"><p className="text-3xl font-bold text-purple-700">{formatDuration(kpi.workOrders?.avgLaborHours || 0)}</p><p className="text-xs text-muted-foreground">Avg Hours</p></div>
              </div>
            </CardContent>
          </Card>

          <div className="grid md:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Package className="h-5 w-5" /> Material Requests</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3">
                  <div><p className="text-sm text-muted-foreground">Total Requests</p><p className="text-xl font-bold">{kpi.materialRequests?.total}</p></div>
                  <div><p className="text-sm text-muted-foreground">Pending</p><p className="text-xl font-bold text-yellow-600">{kpi.materialRequests?.pending}</p></div>
                  <div><p className="text-sm text-muted-foreground">Approved</p><p className="text-xl font-bold text-blue-600">{kpi.materialRequests?.approved}</p></div>
                  <div><p className="text-sm text-muted-foreground">Issued</p><p className="text-xl font-bold text-green-600">{kpi.materialRequests?.issued}</p></div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Wrench className="h-5 w-5" /> Tool Requests</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3">
                  <div><p className="text-sm text-muted-foreground">Total Requests</p><p className="text-xl font-bold">{kpi.toolRequests?.total}</p></div>
                  <div><p className="text-sm text-muted-foreground">Pending</p><p className="text-xl font-bold text-yellow-600">{kpi.toolRequests?.pending}</p></div>
                  <div><p className="text-sm text-muted-foreground">Issued</p><p className="text-xl font-bold text-green-600">{kpi.toolRequests?.issued}</p></div>
                  <div><p className="text-sm text-muted-foreground">Transfers</p><p className="text-xl font-bold text-purple-600">{kpi.toolTransfers?.transferred}</p></div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Timer className="h-5 w-5" /> Downtime Analysis</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3">
                  <div><p className="text-sm text-muted-foreground">Total Downtime</p><p className="text-xl font-bold text-red-600">{formatDuration(kpi.downtime?.totalHours || 0)}</p></div>
                  <div><p className="text-sm text-muted-foreground">Avg per WO</p><p className="text-xl font-bold">{kpi.downtime?.avgMinutesPerWo || 0} min</p></div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><RotateCcw className="h-5 w-5" /> Rework Analysis</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3">
                  <div><p className="text-sm text-muted-foreground">Rework Rate</p><p className="text-xl font-bold text-orange-600">{kpi.rework?.reworkRate || 0}%</p></div>
                  <div><p className="text-sm text-muted-foreground">Total Reworks</p><p className="text-xl font-bold">{kpi.rework?.totalReworks || 0}</p></div>
                </div>
              </CardContent>
            </Card>
          </div>

          {kpi.recentCompletions && kpi.recentCompletions.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Recent Completions</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow><TableHead>WO #</TableHead><TableHead>Title</TableHead><TableHead>Priority</TableHead><TableHead>Approved</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {kpi.recentCompletions.map((c: any) => (
                      <TableRow key={c.id}>
                        <TableCell><Badge variant="outline">{c.workOrder?.woNumber}</Badge></TableCell>
                        <TableCell className="font-medium">{c.workOrder?.title}</TableCell>
                        <TableCell><PriorityBadge priority={c.workOrder?.priority} /></TableCell>
                        <TableCell className="text-sm">{c.supervisorApprovedAt ? formatDistanceToNow(new Date(c.supervisorApprovedAt), { addSuffix: true }) : 'Pending'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
          </TabsContent>

          {/* ===== BACKLOG ANALYSIS TAB ===== */}
          <TabsContent value="backlog" className="mt-4 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">Backlog Analysis</h3>
                <p className="text-sm text-muted-foreground">Open work orders by age bracket, priority, and department</p>
              </div>
              <Button onClick={fetchEnterpriseReport} disabled={enterpriseLoading} className="gap-2"><RefreshCw className={`h-4 w-4 ${enterpriseLoading ? 'animate-spin' : ''}`} /> Load Report</Button>
            </div>

            {enterpriseLoading && !enterpriseReport ? <LoadingSkeleton /> : enterpriseReport ? (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <StatsCard icon={Clock} count={enterpriseReport.backlogAnalytics?.totalOpen || 0} label="Total Open WOs" color="text-amber-600" bgColor="bg-amber-50" />
                  <StatsCard icon={BarChart3} count={enterpriseReport.summary?.completionRate || 0} label="Completion Rate" color="text-emerald-600" bgColor="bg-emerald-50" />
                  <StatsCard icon={DollarSign} count={formatCurrency(enterpriseReport.summary?.totalMaintenanceCost || 0)} label="Total Maint. Cost" color="text-teal-600" bgColor="bg-teal-50" />
                  <StatsCard icon={TrendingUp} count={enterpriseReport.summary?.avgCostPerWO || 0} label="Avg Cost/WO" color="text-sky-600" bgColor="bg-sky-50" />
                </div>

                {/* Backlog by Age */}
                <Card>
                  <CardHeader><CardTitle className="flex items-center gap-2"><Clock className="h-5 w-5 text-amber-600" /> Backlog by Age Bracket</CardTitle></CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {enterpriseReport.backlogAnalytics?.byAgeBracket?.map((bracket: any) => {
                        const total = enterpriseReport.backlogAnalytics.totalOpen || 1;
                        const pct = Math.round((bracket.count / total) * 100);
                        const color = bracket.ageBracket.includes('60+') ? 'bg-red-500' : bracket.ageBracket.includes('31') ? 'bg-orange-500' : bracket.ageBracket.includes('15') ? 'bg-amber-500' : 'bg-teal-500';
                        return (
                          <div key={bracket.ageBracket} className="space-y-1">
                            <div className="flex justify-between text-sm">
                              <span className="font-medium">{bracket.ageBracket}</span>
                              <span className="text-muted-foreground">{bracket.count} WOs ({pct}%)</span>
                            </div>
                            <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} /></div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>

                {/* Backlog by Priority */}
                <div className="grid md:grid-cols-2 gap-6">
                  <Card>
                    <CardHeader><CardTitle>By Priority</CardTitle></CardHeader>
                    <CardContent className="p-0">
                      <Table>
                        <TableHeader><TableRow><TableHead>Priority</TableHead><TableHead className="text-right">Count</TableHead><TableHead className="text-right">%</TableHead></TableRow></TableHeader>
                        <TableBody>
                          {enterpriseReport.backlogAnalytics?.byPriority?.map((p: any) => (
                            <TableRow key={p.priority}>
                              <TableCell><PriorityBadge priority={p.priority} /></TableCell>
                              <TableCell className="text-right font-medium">{p.count}</TableCell>
                              <TableCell className="text-right text-muted-foreground">{enterpriseReport.backlogAnalytics.totalOpen > 0 ? Math.round(p.count / enterpriseReport.backlogAnalytics.totalOpen * 100) : 0}%</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>

                  {/* Cost Analytics */}
                  <Card>
                    <CardHeader><CardTitle className="flex items-center gap-2"><DollarSign className="h-5 w-5 text-teal-600" /> Cost Breakdown</CardTitle></CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {[
                          { label: 'Labor', value: enterpriseReport.costAnalytics?.labor || 0, color: 'text-blue-600' },
                          { label: 'Parts', value: enterpriseReport.costAnalytics?.parts || 0, color: 'text-amber-600' },
                          { label: 'Contractor', value: enterpriseReport.costAnalytics?.contractor || 0, color: 'text-purple-600' },
                        ].map(item => (
                          <div key={item.label} className="flex justify-between items-center">
                            <span className="text-sm text-muted-foreground">{item.label}</span>
                            <span className={`font-semibold ${item.color}`}>{formatCurrency(item.value)}</span>
                          </div>
                        ))}
                        <Separator />
                        <div className="flex justify-between items-center font-bold">
                          <span>Total</span>
                          <span className="text-teal-700">{formatCurrency(enterpriseReport.costAnalytics?.total || 0)}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* SLA Compliance */}
                {enterpriseReport.slaComplianceByPriority && enterpriseReport.slaComplianceByPriority.length > 0 && (
                  <Card>
                    <CardHeader><CardTitle>SLA Compliance by Priority</CardTitle></CardHeader>
                    <CardContent className="p-0">
                      <Table>
                        <TableHeader><TableRow><TableHead>Priority</TableHead><TableHead className="text-right">Within SLA</TableHead><TableHead className="text-right">Breached</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Compliance</TableHead></TableRow></TableHeader>
                        <TableBody>
                          {enterpriseReport.slaComplianceByPriority.map((s: any) => (
                            <TableRow key={s.priority}>
                              <TableCell><PriorityBadge priority={s.priority} /></TableCell>
                              <TableCell className="text-right text-emerald-600">{s.withinSLA}</TableCell>
                              <TableCell className="text-right text-red-500">{s.breached}</TableCell>
                              <TableCell className="text-right">{s.total}</TableCell>
                              <TableCell className="text-right">
                                <Badge variant="outline" className={s.compliancePercent >= 90 ? 'bg-emerald-100 text-emerald-700' : s.compliancePercent >= 70 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}>
                                  {s.compliancePercent}%
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                )}
              </>
            ) : (
              <Card><CardContent className="py-12"><EmptyState icon={Clock} title="No backlog data" description="Click 'Load Report' to generate the backlog analysis" /></CardContent></Card>
            )}
          </TabsContent>

          {/* ===== DOWNTIME DEEP DIVE TAB ===== */}
          <TabsContent value="downtime-deep" className="mt-4 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">Downtime Deep Dive</h3>
                <p className="text-sm text-muted-foreground">Detailed downtime analysis with MTBF, MTTR, and availability metrics</p>
              </div>
              <Button onClick={fetchDowntimeReport} disabled={downtimeLoading} className="gap-2"><RefreshCw className={`h-4 w-4 ${downtimeLoading ? 'animate-spin' : ''}`} /> Load Report</Button>
            </div>

            {downtimeLoading && !downtimeReport ? <LoadingSkeleton /> : downtimeReport ? (
              <>
                {/* KPI Metrics */}
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                  <StatsCard icon={Timer} count={formatDuration(downtimeReport.metrics?.totalDowntimeHours || 0)} label="Total Downtime" color="text-red-600" bgColor="bg-red-50" />
                  <StatsCard icon={Activity} count={formatDuration(downtimeReport.metrics?.mtbfHours || 0)} label="MTBF" color="text-blue-600" bgColor="bg-blue-50" />
                  <StatsCard icon={Wrench} count={formatDuration(downtimeReport.metrics?.mttrHours || 0)} label="MTTR" color="text-orange-600" bgColor="bg-orange-50" />
                  <StatsCard icon={TrendingUp} count={`${downtimeReport.metrics?.availabilityPercent || 100}%`} label="Availability" color="text-emerald-600" bgColor="bg-emerald-50" />
                  <StatsCard icon={AlertTriangle} count={downtimeReport.metrics?.totalEvents || 0} label="Downtime Events" color="text-amber-600" bgColor="bg-amber-50" />
                </div>

                {/* Top 10 Assets by Downtime */}
                {downtimeReport.top10Assets && downtimeReport.top10Assets.length > 0 && (
                  <Card>
                    <CardHeader><CardTitle>Top 10 Assets by Downtime</CardTitle></CardHeader>
                    <CardContent className="p-0">
                      <div className="max-h-96 overflow-y-auto">
                        <Table>
                          <TableHeader><TableRow><TableHead>Asset</TableHead><TableHead className="text-right">Events</TableHead><TableHead className="text-right">Total Hours</TableHead><TableHead className="text-right">Planned (h)</TableHead><TableHead className="text-right">Unplanned (h)</TableHead><TableHead className="text-right">Prod. Loss</TableHead></TableRow></TableHeader>
                          <TableBody>
                            {downtimeReport.top10Assets.map((a: any, idx: number) => (
                              <TableRow key={a.assetName}>
                                <TableCell>
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs text-muted-foreground w-5">#{idx + 1}</span>
                                    <span className="font-medium text-sm">{a.assetName}</span>
                                  </div>
                                </TableCell>
                                <TableCell className="text-right">{a.events}</TableCell>
                                <TableCell className="text-right font-semibold text-red-600">{formatDuration(a.totalHours)}</TableCell>
                                <TableCell className="text-right text-blue-600">{formatDuration(a.plannedHours)}</TableCell>
                                <TableCell className="text-right text-red-500">{formatDuration(a.unplannedHours)}</TableCell>
                                <TableCell className="text-right text-amber-600">{a.productionLoss > 0 ? formatCurrency(a.productionLoss) : '—'}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>
                )}

                <div className="grid md:grid-cols-2 gap-6">
                  {/* By Category */}
                  {downtimeReport.breakdownByCategory && downtimeReport.breakdownByCategory.length > 0 && (
                    <Card>
                      <CardHeader><CardTitle>By Category</CardTitle></CardHeader>
                      <CardContent className="p-0">
                        <Table>
                          <TableHeader><TableRow><TableHead>Category</TableHead><TableHead className="text-right">Events</TableHead><TableHead className="text-right">Hours</TableHead></TableRow></TableHeader>
                          <TableBody>
                            {downtimeReport.breakdownByCategory.map((c: any) => (
                              <TableRow key={c.category}>
                                <TableCell><StatusBadge status={c.category} /></TableCell>
                                <TableCell className="text-right">{c.events}</TableCell>
                                <TableCell className="text-right font-medium">{formatDuration(c.totalHours)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  )}

                  {/* Cost Impact */}
                  <Card>
                    <CardHeader><CardTitle className="flex items-center gap-2"><DollarSign className="h-5 w-5 text-teal-600" /> Cost Impact</CardTitle></CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        <div className="flex justify-between"><span className="text-sm text-muted-foreground">Production Loss</span><span className="font-semibold text-red-600">{formatCurrency(downtimeReport.costImpact?.totalProductionLoss || 0)}</span></div>
                        <div className="flex justify-between"><span className="text-sm text-muted-foreground">Related WO Cost</span><span className="font-semibold">{formatCurrency(downtimeReport.costImpact?.relatedWOCost || 0)}</span></div>
                        <Separator />
                        <div className="flex justify-between items-center font-bold text-lg"><span>Est. Total Impact</span><span className="text-red-700">{formatCurrency(downtimeReport.costImpact?.estimatedTotalImpact || 0)}</span></div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Trend */}
                {downtimeReport.trending?.data && downtimeReport.trending.data.length > 0 && (
                  <Card>
                    <CardHeader><CardTitle>Downtime Trend ({downtimeReport.trending.grouping})</CardTitle></CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {downtimeReport.trending.data.map((t: any) => {
                          const maxHours = Math.max(...downtimeReport.trending.data.map((d: any) => d.totalHours), 1);
                          const pct = Math.round((t.totalHours / maxHours) * 100);
                          return (
                            <div key={t.period} className="flex items-center gap-3">
                              <span className="text-xs text-muted-foreground w-24 flex-shrink-0">{t.period}</span>
                              <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden"><div className="h-full rounded-full bg-red-400 transition-all" style={{ width: `${pct}%` }} /></div>
                              <span className="text-xs font-medium w-16 text-right">{formatDuration(t.totalHours)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            ) : (
              <Card><CardContent className="py-12"><EmptyState icon={Timer} title="No downtime data" description="Click 'Load Report' to generate the downtime analysis" /></CardContent></Card>
            )}
          </TabsContent>

          {/* ===== REPEAT FAILURES TAB ===== */}
          <TabsContent value="repeat-failures" className="mt-4 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">Repeat Failure Analysis</h3>
                <p className="text-sm text-muted-foreground">Assets with recurring failures requiring investigation</p>
              </div>
              <Button onClick={fetchRepeatReport} disabled={repeatLoading} className="gap-2"><RefreshCw className={`h-4 w-4 ${repeatLoading ? 'animate-spin' : ''}`} /> Load Report</Button>
            </div>

            {repeatLoading && !repeatReport ? <LoadingSkeleton /> : repeatReport ? (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                  <StatsCard icon={AlertTriangle} count={repeatReport.problematicAssets?.length || 0} label="Problematic Assets" color="text-red-600" bgColor="bg-red-50" />
                  <StatsCard icon={FileText} count={repeatReport.totalFailureRecords || 0} label="Total Failure Records" color="text-slate-600" bgColor="bg-slate-50" />
                  <StatsCard icon={Info} count={repeatReport.recommendedActions?.length || 0} label="Recommended Actions" color="text-amber-600" bgColor="bg-amber-50" />
                </div>

                {/* Problematic Assets Table */}
                {repeatReport.problematicAssets && repeatReport.problematicAssets.length > 0 ? (
                  <Card>
                    <CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-red-500" /> Problematic Assets (3+ Failures)</CardTitle></CardHeader>
                    <CardContent className="p-0">
                      <div className="max-h-96 overflow-y-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Asset</TableHead>
                              <TableHead className="text-center">Failures</TableHead>
                              <TableHead>Failure Modes</TableHead>
                              <TableHead className="text-right">Downtime</TableHead>
                              <TableHead className="text-right">Cost</TableHead>
                              <TableHead className="text-right">Freq/Month</TableHead>
                              <TableHead>Last Failure</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {repeatReport.problematicAssets.map((a: any) => (
                              <TableRow key={a.assetId}>
                                <TableCell>
                                  <div>
                                    <p className="font-medium text-sm">{a.assetName}</p>
                                    {a.assetCode && <p className="text-xs text-muted-foreground">{a.assetCode}</p>}
                                  </div>
                                </TableCell>
                                <TableCell className="text-center">
                                  <Badge variant="outline" className={a.failureCount >= 5 ? 'bg-red-100 text-red-700' : a.failureCount >= 3 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100'}>
                                    {a.failureCount}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <div className="flex flex-wrap gap-1">
                                    {a.failureModes?.map((fm: string) => (
                                      <Badge key={fm} variant="secondary" className="text-[10px]">{fm}</Badge>
                                    ))}
                                  </div>
                                </TableCell>
                                <TableCell className="text-right text-red-600">{formatDuration(a.totalDowntimeHours)}</TableCell>
                                <TableCell className="text-right">{formatCurrency(a.totalRepairCost)}</TableCell>
                                <TableCell className="text-right font-medium text-orange-600">{a.frequencyPerMonth}</TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                  {a.lastFailureDate ? formatDistanceToNow(new Date(a.lastFailureDate), { addSuffix: true }) : '—'}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <Card><CardContent className="py-8"><EmptyState icon={CheckCircle2} title="No problematic assets found" description="All assets are within acceptable failure thresholds" /></CardContent></Card>
                )}

                {/* Recommended Actions */}
                {repeatReport.recommendedActions && repeatReport.recommendedActions.length > 0 && (
                  <Card>
                    <CardHeader><CardTitle className="flex items-center gap-2"><Info className="h-5 w-5 text-amber-500" /> Recommended Actions</CardTitle></CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {repeatReport.recommendedActions.map((action: any, idx: number) => {
                          const typeConfig: Record<string, { icon: React.ElementType; color: string; bg: string }> = {
                            pm_schedule_review: { icon: Clock, color: 'text-blue-600', bg: 'bg-blue-50' },
                            component_replacement: { icon: Wrench, color: 'text-red-600', bg: 'bg-red-50' },
                            rca: { icon: Search, color: 'text-amber-600', bg: 'bg-amber-50' },
                            replacement_analysis: { icon: DollarSign, color: 'text-purple-600', bg: 'bg-purple-50' },
                          };
                          const cfg = typeConfig[action.type] || { icon: Info, color: 'text-slate-600', bg: 'bg-slate-50' };
                          const IconComp = cfg.icon;
                          return (
                            <div key={idx} className={`flex items-start gap-3 p-3 rounded-lg border ${action.priority === 'high' ? 'border-red-200 bg-red-50/50' : 'border-amber-200 bg-amber-50/30'}`}>
                              <div className={`${cfg.bg} p-2 rounded-lg flex-shrink-0 mt-0.5`}><IconComp className={`h-4 w-4 ${cfg.color}`} /></div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium">{action.action}</p>
                                <p className="text-xs text-muted-foreground mt-0.5">{action.reason}</p>
                              </div>
                              <Badge variant="outline" className={action.priority === 'high' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}>
                                {action.priority}
                              </Badge>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Root Cause Frequency */}
                {repeatReport.rootCauseFrequency && repeatReport.rootCauseFrequency.length > 0 && (
                  <Card>
                    <CardHeader><CardTitle>Top Root Causes</CardTitle></CardHeader>
                    <CardContent className="p-0">
                      <Table>
                        <TableHeader><TableRow><TableHead>Root Cause</TableHead><TableHead className="text-right">Occurrences</TableHead></TableRow></TableHeader>
                        <TableBody>
                          {repeatReport.rootCauseFrequency.map((rc: any, idx: number) => (
                            <TableRow key={idx}>
                              <TableCell className="text-sm max-w-md truncate">{rc.rootCause}</TableCell>
                              <TableCell className="text-right"><Badge variant="secondary">{rc.count}</Badge></TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                )}
              </>
            ) : (
              <Card><CardContent className="py-12"><EmptyState icon={AlertTriangle} title="No repeat failure data" description="Click 'Load Report' to generate the repeat failure analysis" /></CardContent></Card>
            )}
          </TabsContent>

          {/* ===== RECONCILIATION TAB ===== */}
          <TabsContent value="reconciliation" className="mt-4 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">Material Reconciliation Report</h3>
                <p className="text-sm text-muted-foreground">Track consumed, wasted, and returned materials across all repair work orders</p>
              </div>
              <Button onClick={() => fetchReconReport(1)} disabled={reconLoading} className="gap-2"><RefreshCw className={`h-4 w-4 ${reconLoading ? 'animate-spin' : ''}`} /> Load Report</Button>
            </div>

            {reconReport ? (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-violet-50 border border-violet-200 rounded-lg p-4 text-center">
                    <p className="text-3xl font-bold text-violet-700">{reconReport.summary.totalRecords}</p>
                    <p className="text-xs text-muted-foreground">Total Issued</p>
                  </div>
                  <div className="bg-teal-50 border border-teal-200 rounded-lg p-4 text-center">
                    <p className="text-3xl font-bold text-teal-700">{reconReport.summary.overallReconciliationRate}%</p>
                    <p className="text-xs text-muted-foreground">Reconciliation Rate</p>
                  </div>
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
                    <p className="text-3xl font-bold text-red-600">{reconReport.summary.overallWasteRate}%</p>
                    <p className="text-xs text-muted-foreground">Waste Rate</p>
                  </div>
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-center">
                    <p className="text-3xl font-bold text-emerald-700">{reconReport.summary.completionRate}%</p>
                    <p className="text-xs text-muted-foreground">Reported</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                  <StatsCard icon={PackageOpen} count={reconReport.summary.totalRequested} label="Total Requested" color="text-slate-600" bgColor="bg-slate-50" />
                  <StatsCard icon={PackageCheck} count={reconReport.summary.totalIssued} label="Total Issued" color="text-emerald-600" bgColor="bg-emerald-50" />
                  <StatsCard icon={ClipboardList} count={reconReport.summary.totalConsumed} label="Total Consumed" color="text-teal-600" bgColor="bg-teal-50" />
                  <StatsCard icon={AlertTriangle} count={reconReport.summary.totalWasted} label="Total Wasted" color="text-red-600" bgColor="bg-red-50" />
                  <StatsCard icon={RotateCcw} count={reconReport.summary.totalReturned} label="Total Returned" color="text-amber-600" bgColor="bg-amber-50" />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <StatsCard icon={DollarSign} count={formatCurrency(reconReport.summary.totalCost)} label="Total Issued Cost" color="text-sky-600" bgColor="bg-sky-50" />
                  <StatsCard icon={DollarSign} count={formatCurrency(reconReport.summary.totalWastedCost)} label="Total Waste Cost" color="text-red-600" bgColor="bg-red-50" />
                  <StatsCard icon={TrendingUp} count={formatCurrency(reconReport.summary.savingsFromReturns)} label="Savings from Returns" color="text-emerald-600" bgColor="bg-emerald-50" />
                </div>

                {reconReport.itemBreakdown && reconReport.itemBreakdown.length > 0 && (
                  <Card>
                    <CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-red-500" /> Top Wasteful Items</CardTitle></CardHeader>
                    <CardContent className="p-0">
                      <Table>
                        <TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="text-right">Total Issued</TableHead><TableHead className="text-right">Wasted</TableHead><TableHead className="text-right">Waste Rate</TableHead></TableRow></TableHeader>
                        <TableBody>
                          {reconReport.itemBreakdown.slice(0, 5).map((item: any) => (
                            <TableRow key={item.itemName}>
                              <TableCell className="font-medium">{item.itemName}</TableCell>
                              <TableCell className="text-right">{item.totalIssued}</TableCell>
                              <TableCell className="text-right text-red-600">{item.totalWasted}</TableCell>
                              <TableCell className="text-right">
                                <Badge variant="outline" className={item.wasteRate > 20 ? 'bg-red-100 text-red-700' : item.wasteRate > 10 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}>
                                  {item.wasteRate}%
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                )}

                <Card>
                  <CardHeader><CardTitle>Reconciliation Details</CardTitle></CardHeader>
                  <CardContent className="p-0">
                    <div className="max-h-96 overflow-y-auto">
                      <Table>
                        <TableHeader><TableRow><TableHead>Item</TableHead><TableHead>WO #</TableHead><TableHead className="text-right">Issued</TableHead><TableHead className="text-right">Consumed</TableHead><TableHead className="text-right">Wasted</TableHead><TableHead className="text-right">Returned</TableHead><TableHead className="text-right">Rate</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                        <TableBody>
                          {reconReport.details.map((d: any) => (
                            <TableRow key={d.id}>
                              <TableCell className="font-medium text-sm">{d.itemName}</TableCell>
                              <TableCell><Badge variant="outline" className="font-mono text-xs">{d.woNumber}</Badge></TableCell>
                              <TableCell className="text-right">{d.issuedQty}</TableCell>
                              <TableCell className="text-right text-teal-600">{d.consumedQty}</TableCell>
                              <TableCell className="text-right text-red-500">{d.wastedQty}</TableCell>
                              <TableCell className="text-right text-amber-600">{d.returnedQty}</TableCell>
                              <TableCell className="text-right">
                                {d.reconciliationRate !== null ? (
                                  <Badge variant="outline" className={d.reconciliationRate >= 90 ? 'bg-emerald-100 text-emerald-700' : d.reconciliationRate >= 70 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}>
                                    {d.reconciliationRate}%
                                  </Badge>
                                ) : <span className="text-xs text-muted-foreground">Pending</span>}
                              </TableCell>
                              <TableCell>{d.isReconciled ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Clock className="h-4 w-4 text-amber-500" />}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>

                {reconReport.pagination && reconReport.pagination.totalPages > 1 && (
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">Page {reconReport.pagination.page} of {reconReport.pagination.totalPages}</p>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" disabled={reconPage <= 1} onClick={() => fetchReconReport(reconPage - 1)}>Previous</Button>
                      <Button variant="outline" size="sm" disabled={reconPage >= reconReport.pagination.totalPages} onClick={() => fetchReconReport(reconPage + 1)}>Next</Button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <Card>
                <CardContent className="py-12">
                  <EmptyState icon={ClipboardList} title="No reconciliation data loaded" description="Click 'Load Report' to generate the reconciliation report" />
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

// ============================================================================
// PAGE 8: SPARE PART RETURNS (Reusable Parts Refurbishment)
// ============================================================================

const SPARE_RETURN_STAGES: PipelineStage[] = [
  { key: 'pending', label: 'Pending', icon: Clock },
  { key: 'inspected', label: 'Inspected', icon: Eye },
  { key: 'refurbishing', label: 'Refurbishing', icon: Wrench },
  { key: 'refurbished', label: 'Refurbished', icon: CheckCircle2 },
  { key: 'returned_to_store', label: 'In Store', icon: Warehouse },
  { key: 'disposed', label: 'Disposed', icon: Ban },
];

export function SparePartReturnsPage() {
  const { user, hasPermission, isAdmin } = useAuthStore();
  const { pageParams } = useNavigationStore();
  const repairsEnabled = useModuleEnabled(MODULE_CODES.REPAIRS);
  const [returns, setReturns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any>(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<{ page: number; totalPages: number; total: number } | null>(null);
  const [detailItem, setDetailItem] = useState<any>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [createForm, setCreateForm] = useState({
    workOrderId: '', componentId: '', installedSparePartId: '', installedSparePartStatus: '', itemId: '', itemName: '', partSerialNumber: '', quantity: '1', removalReason: '',
    conditionOnReturn: 'used', damageDescription: '', refurbishmentNeeded: false, isConsumed: false,
    refurbishmentNotes: '', estimatedRefurbCost: '', notes: '',
  });
  const [actionOpen, setActionOpen] = useState(false);
  const [actionTarget, setActionTarget] = useState<{ id: string; action: string } | null>(null);
  const [actionForm, setActionForm] = useState({ notes: '', refurbishmentNeeded: true, estimatedCost: '', disposalReason: '' });

  const fetchReturns = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterStatus !== 'all') params.set('status', filterStatus);
    params.set('page', String(page));
    params.set('limit', '20');
    const [listRes, statsRes] = await Promise.all([
      api.get(`/api/repairs/spare-part-returns?${params}`),
      api.get('/api/repairs/spare-part-returns?stats=true'),
    ]);
    if (listRes.success) { setReturns(listRes.data || []); if (listRes.pagination) setPagination(listRes.pagination); }
    if (statsRes.success) setStats(statsRes.data);
    setLoading(false);
  }, [filterStatus, page]);

  useEffect(() => { fetchReturns(); }, [fetchReturns]);

  useEffect(() => {
    if (!pageParams?.installedSparePartId) return;
    setCreateForm((current) => ({
      ...current,
      componentId: pageParams.componentId || current.componentId,
      installedSparePartId: pageParams.installedSparePartId,
      installedSparePartStatus: pageParams.installedSparePartStatus || 'installed',
      itemName: pageParams.itemName || current.itemName,
      partSerialNumber: pageParams.partSerialNumber || current.partSerialNumber,
      quantity: pageParams.quantity || current.quantity,
    }));
    setCreateOpen(true);
  }, [pageParams?.componentId, pageParams?.installedSparePartId, pageParams?.installedSparePartStatus, pageParams?.itemName, pageParams?.partSerialNumber, pageParams?.quantity]);

  const handleCreate = async () => {
    if (!createForm.workOrderId || !createForm.itemName) { toast.error('Work Order and Item Name are required'); return; }
    if (createForm.installedSparePartId && createForm.installedSparePartStatus === 'installed' && !createForm.removalReason.trim()) { toast.error('Removal reason is required for an installed part'); return; }
    setSubmitting(true);
    const res = await api.post('/api/repairs/spare-part-returns', {
      workOrderId: createForm.workOrderId, componentId: createForm.componentId || undefined, installedSparePartId: createForm.installedSparePartId || undefined, itemId: createForm.itemId || undefined,
      itemName: createForm.itemName, partSerialNumber: createForm.partSerialNumber || undefined,
      quantity: parseFloat(createForm.quantity) || 1, removalReason: createForm.removalReason || undefined, conditionOnReturn: createForm.conditionOnReturn,
      damageDescription: createForm.damageDescription || undefined,
      refurbishmentNeeded: createForm.refurbishmentNeeded,
      isConsumed: createForm.isConsumed,
      refurbishmentNotes: createForm.refurbishmentNotes || undefined,
      estimatedRefurbCost: createForm.estimatedRefurbCost ? parseFloat(createForm.estimatedRefurbCost) : undefined,
      notes: createForm.notes || undefined,
    });
    if (res.success) {
      toast.success('Spare part return created'); setCreateOpen(false);
      setCreateForm({ workOrderId: '', componentId: '', installedSparePartId: '', installedSparePartStatus: '', itemId: '', itemName: '', partSerialNumber: '', quantity: '1', removalReason: '', conditionOnReturn: 'used', damageDescription: '', refurbishmentNeeded: false, isConsumed: false, refurbishmentNotes: '', estimatedRefurbCost: '', notes: '' });
      fetchReturns();
    } else toast.error(res.error || 'Failed');
    setSubmitting(false);
  };

  const handleAction = async (id: string, action: string, extra?: Record<string, any>) => {
    setSubmitting(true);
    const res = await api.post(`/api/repairs/spare-part-returns/${id}`, { action, ...extra });
    if (res.success) { toast.success('Action completed'); fetchReturns(); if (detailOpen && detailItem?.id === id) { setDetailOpen(false); } setActionOpen(false); }
    else toast.error(res.error || 'Failed');
    setSubmitting(false);
  };

  const filtered = useMemo(() => returns.filter(r =>
    !searchText || r.itemName?.toLowerCase().includes(searchText.toLowerCase()) || r.returnNumber?.toLowerCase().includes(searchText.toLowerCase())
  ), [returns, searchText]);

  if (!repairsEnabled) {
    return (<div className="flex items-center justify-center h-96"><div className="text-center"><p className="text-muted-foreground">Repairs module is not active.</p><p className="text-sm text-muted-foreground mt-1">Enable it in Settings → Modules.</p></div></div>);
  }

  return (
    <div className="page-content">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-teal-100 rounded-xl"><RefreshCw className="h-6 w-6 text-teal-700" /></div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold tracking-tight">Spare Part Returns</h2>
              <Badge variant="secondary" className="font-mono">{returns.length}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">Track reusable parts returned from machines for refurbishment</p>
          </div>
        </div>
        {(user && (hasPermission('spare_part_returns.create') || isAdmin())) && <Button onClick={() => setCreateOpen(true)} className="gap-2"><Plus className="h-4 w-4" /> New Return</Button>}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard icon={Clock} count={stats?.byStatus?.pending ?? 0} label="Pending Inspection" color="text-yellow-600" bgColor="bg-yellow-50" onClick={() => { setFilterStatus('pending'); setPage(1); }} />
        <StatsCard icon={Wrench} count={stats?.byStatus?.refurbishing ?? 0} label="Being Refurbished" color="text-blue-600" bgColor="bg-blue-50" onClick={() => { setFilterStatus('refurbishing'); setPage(1); }} />
        <StatsCard icon={CheckCircle2} count={stats?.byStatus?.refurbished ?? 0} label="Refurbished" color="text-emerald-600" bgColor="bg-emerald-50" onClick={() => { setFilterStatus('refurbished'); setPage(1); }} />
        <StatsCard icon={Warehouse} count={stats?.byStatus?.returned_to_store ?? 0} label="Back in Store" color="text-teal-600" bgColor="bg-teal-50" onClick={() => { setFilterStatus('returned_to_store'); setPage(1); }} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search parts..." value={searchText} onChange={(e) => setSearchText(e.target.value)} className="pl-9" />
        </div>
        <Select value={filterStatus} onValueChange={(v) => { setFilterStatus(v); setPage(1); }}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="inspected">Inspected</SelectItem>
            <SelectItem value="refurbishing">Refurbishing</SelectItem>
            <SelectItem value="refurbished">Refurbished</SelectItem>
            <SelectItem value="returned_to_store">Returned to Store</SelectItem>
            <SelectItem value="disposed">Disposed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {loading ? <LoadingSkeleton /> : filtered.length === 0 ? (
            <EmptyState icon={RefreshCw} title="No spare part returns" description="Return reusable parts from machines for refurbishment" />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Return #</TableHead>
                    <TableHead>Part</TableHead>
                    <TableHead>WO #</TableHead>
                    <TableHead>Component</TableHead>
                    <TableHead>Condition</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow key={r.id} className="cursor-pointer hover:bg-muted/30" onClick={() => { setDetailItem(r); setDetailOpen(true); }}>
                      <TableCell><Badge variant="outline" className="font-mono text-xs">{r.returnNumber}</Badge></TableCell>
                      <TableCell>
                        <div className="font-medium text-sm">{r.itemName}</div>
                        {r.partSerialNumber && <div className="text-xs text-muted-foreground">SN: {r.partSerialNumber}</div>}
                      </TableCell>
                      <TableCell><Badge variant="outline" className="font-mono text-xs">{r.workOrder?.woNumber}</Badge></TableCell>
                      <TableCell>{r.component ? <span className="text-sm">{r.component.name}</span> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={r.conditionOnReturn === 'good' || r.conditionOnReturn === 'new' ? 'bg-emerald-100 text-emerald-800' : r.conditionOnReturn === 'damaged' || r.conditionOnReturn === 'worn' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}>
                          {r.conditionOnReturn?.replace('_', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell><span className="font-medium">{r.quantity}</span></TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <StatusBadge status={r.status} />
                          <MiniPipeline stages={SPARE_RETURN_STAGES} currentStatus={r.status} />
                        </div>
                      </TableCell>
                      <TableCell><OverduePulse isOverdue={false} date={r.createdAt} /></TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                          {r.status === 'pending' && canInspectSparePartReturn(user) && (
                            <Button size="sm" className="h-7 gap-1 bg-blue-600 hover:bg-blue-700 text-white" onClick={() => { setActionTarget({ id: r.id, action: 'inspect' }); setActionForm({ notes: '', refurbishmentNeeded: true, estimatedCost: '', disposalReason: '' }); setActionOpen(true); }}>
                              <Eye className="h-3.5 w-3.5" /> Inspect
                            </Button>
                          )}
                          {r.status === 'inspected' && r.refurbishmentNeeded && canStartSpareRefurbishment(user) && (
                            <Button size="sm" className="h-7 gap-1 bg-violet-600 hover:bg-violet-700 text-white" onClick={() => handleAction(r.id, 'start_refurbishment')}>
                              <Wrench className="h-3.5 w-3.5" /> Start Refurb
                            </Button>
                          )}
                          {r.status === 'refurbishing' && canCompleteSpareRefurbishment(r, user) && (
                            <Button size="sm" className="h-7 gap-1 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => handleAction(r.id, 'complete_refurbishment')}>
                              <CheckCircle2 className="h-3.5 w-3.5" /> Complete
                            </Button>
                          )}
                          {(r.status === 'refurbished' || (r.status === 'inspected' && !r.refurbishmentNeeded)) && canReturnSparePartToStore(user) && (
                            <Button size="sm" className="h-7 gap-1 bg-teal-600 hover:bg-teal-700 text-white" onClick={() => handleAction(r.id, 'return_to_store')}>
                              <Warehouse className="h-3.5 w-3.5" /> To Store
                            </Button>
                          )}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7"><MoreHorizontal className="h-3.5 w-3.5" /></Button></DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => { setDetailItem(r); setDetailOpen(true); }}><Eye className="h-4 w-4 mr-2" /> View Details</DropdownMenuItem>
                              {canDisposeSparePartReturn(user) && r.status !== 'disposed' && r.status !== 'returned_to_store' && r.status !== 'rejected' && (
                                <DropdownMenuItem className="text-red-600" onClick={() => handleAction(r.id, 'dispose', { disposalReason: 'Disposed as unusable' })}><Ban className="h-4 w-4 mr-2" /> Dispose</DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Inspect Dialog */}
      <ResponsiveDialog open={actionOpen} onOpenChange={setActionOpen}>
        {actionTarget?.action === 'inspect' && (
          <>
            <div className="space-y-1.5 mb-4">
              <h2 className="text-lg font-semibold">Inspect Spare Part Return</h2>
              <p className="text-sm text-muted-foreground">Assess condition and determine if refurbishment is needed.</p>
            </div>
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-lg border">
                <input type="checkbox" id="refurbNeeded" checked={actionForm.refurbishmentNeeded} onChange={e => setActionForm(p => ({ ...p, refurbishmentNeeded: e.target.checked }))} className="h-4 w-4" />
                <Label htmlFor="refurbNeeded">Refurbishment Needed</Label>
              </div>
              {actionForm.refurbishmentNeeded && (
                <div className="space-y-2">
                  <Label>Estimated Refurbishment Cost</Label>
                  <Input type="number" value={actionForm.estimatedCost} onChange={e => setActionForm(p => ({ ...p, estimatedCost: e.target.value }))} placeholder="0.00" />
                </div>
              )}
              <div className="space-y-2">
                <Label>Inspection Notes</Label>
                <Textarea value={actionForm.notes} onChange={e => setActionForm(p => ({ ...p, notes: e.target.value }))} placeholder="Findings from inspection..." rows={3} />
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="outline" onClick={() => setActionOpen(false)}>Cancel</Button>
                <Button className="bg-blue-600 hover:bg-blue-700 text-white" disabled={submitting} onClick={() => handleAction(actionTarget.id, 'inspect', {
                  refurbishmentNeeded: actionForm.refurbishmentNeeded,
                  estimatedRefurbCost: actionForm.estimatedCost ? parseFloat(actionForm.estimatedCost) : undefined,
                  inspectionNotes: actionForm.notes || undefined,
                })}>Submit Inspection</Button>
              </div>
            </div>
          </>
        )}
      </ResponsiveDialog>

      {/* Create Dialog */}
      <ResponsiveDialog open={createOpen} onOpenChange={setCreateOpen}>
        <div className="space-y-1.5 mb-4">
          <h2 className="text-lg font-semibold">Return Spare Part</h2>
          <p className="text-sm text-muted-foreground">Register a reusable part returned from a machine during repair.</p>
        </div>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Work Order *</Label>
            <AsyncSearchableSelect placeholder="Search work order..." fetchOptions={async (q) => {
              const res = await api.get(`/api/work-orders?search=${q}&status=planned,assigned,in_progress,on_hold,waiting_parts,waiting_tools,waiting_shutdown,waiting_permit,pending_handover,completed&limit=20`);
              if (res.success) return (res.data || []).map((wo: any) => ({ value: wo.id, label: `${wo.woNumber} - ${wo.title}` }));
              return [];
            }} value={createForm.workOrderId} onValueChange={v => setCreateForm(p => ({ ...p, workOrderId: v, componentId: '', installedSparePartId: '', installedSparePartStatus: '', itemId: '', itemName: '', partSerialNumber: '', quantity: '1', removalReason: '' }))} />
          </div>
          <div className="space-y-2">
            <Label>Component <span className="text-xs text-muted-foreground">(optional)</span></Label>
            <AsyncSearchableSelect placeholder={createForm.workOrderId ? 'Search components...' : 'Select a Work Order first'} fetchOptions={async (q) => {
              if (!createForm.workOrderId) return [];
              const woRes = await api.get(`/api/work-orders/${createForm.workOrderId}`);
              const assetId = woRes.data?.assetId;
              const params = new URLSearchParams({ search: q, limit: '30' });
              if (assetId) params.set('assetId', assetId);
              const res = await api.get(`/api/component-registry?${params}`);
              if (res.success) return (res.data || []).map((c: any) => ({ value: c.id, label: `${c.componentCode} - ${c.name}${c.criticality ? ` [${c.criticality}]` : ''}` }));
              return [];
            }} deps={[createForm.workOrderId]} value={createForm.componentId} onValueChange={v => setCreateForm(p => ({ ...p, componentId: v, installedSparePartId: '', installedSparePartStatus: '', itemId: '', itemName: '', partSerialNumber: '', quantity: '1', removalReason: '' }))} />
          </div>
          <div className="space-y-2">
            <Label>Installed part to remove <span className="text-xs text-muted-foreground">(recommended for serialized/reusable parts)</span></Label>
            <AsyncSearchableSelect placeholder={createForm.componentId ? 'Select installed part...' : 'Select a Component first'} fetchOptions={async (q) => {
              if (!createForm.componentId) return [];
              const res = await api.get(`/api/component-registry/${createForm.componentId}/installed-parts`);
              if (!res.success) return [];
              const query = q.toLowerCase();
              return (res.data || []).filter((part: any) => (part.status === 'installed' || part.status === 'removed') && (!query || part.partName?.toLowerCase().includes(query) || part.partCode?.toLowerCase().includes(query) || part.serialNumber?.toLowerCase().includes(query))).map((part: any) => ({
                value: part.id,
                label: `${part.partName}${part.partCode ? ` (${part.partCode})` : ''}${part.serialNumber ? ` · SN ${part.serialNumber}` : ''} · qty ${part.quantity} · ${part.status === 'removed' ? 'already removed' : 'installed'}`,
              }));
            }} deps={[createForm.componentId]} value={createForm.installedSparePartId} onValueChange={async v => {
              if (!v || !createForm.componentId) { setCreateForm(p => ({ ...p, installedSparePartId: '', installedSparePartStatus: '', removalReason: '' })); return; }
              const res = await api.get(`/api/component-registry/${createForm.componentId}/installed-parts`);
              const part = (res.data || []).find((row: any) => row.id === v);
              if (!part) { toast.error('Installed part could not be loaded'); return; }
              setCreateForm(p => ({ ...p, installedSparePartId: v, installedSparePartStatus: part.status || '', itemId: part.inventoryItemId || '', itemName: part.partName || '', partSerialNumber: part.serialNumber || '', quantity: String(part.quantity || 1), removalReason: '' }));
            }} />
            {createForm.installedSparePartId && <p className="text-xs text-teal-700">{createForm.installedSparePartStatus === 'removed' ? 'Legacy removed part selected. Submitting will attach its existing removal history to return custody.' : 'Physical identity is locked. Submitting this return will remove the part and open custody in one transaction.'}</p>}
          </div>
          {createForm.installedSparePartId && createForm.installedSparePartStatus === 'installed' && (
            <div className="space-y-2">
              <Label>Removal Reason *</Label>
              <Textarea value={createForm.removalReason} onChange={e => setCreateForm(p => ({ ...p, removalReason: e.target.value }))} placeholder="Why is this installed part being removed?" rows={2} />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Item Name *</Label>
              <Input value={createForm.itemName} onChange={e => setCreateForm(p => ({ ...p, itemName: e.target.value }))} placeholder="Part name" readOnly={Boolean(createForm.installedSparePartId)} />
            </div>
            <div className="space-y-2">
              <Label>Quantity</Label>
              <Input type="number" value={createForm.quantity} onChange={e => setCreateForm(p => ({ ...p, quantity: e.target.value }))} min="1" readOnly={Boolean(createForm.installedSparePartId)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Serial Number</Label>
              <Input value={createForm.partSerialNumber} onChange={e => setCreateForm(p => ({ ...p, partSerialNumber: e.target.value }))} placeholder="If available" readOnly={Boolean(createForm.installedSparePartId)} />
            </div>
            <div className="space-y-2">
              <Label>Condition on Return</Label>
              <Select value={createForm.conditionOnReturn} onValueChange={v => setCreateForm(p => ({ ...p, conditionOnReturn: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">New</SelectItem>
                  <SelectItem value="good">Good</SelectItem>
                  <SelectItem value="fair">Fair</SelectItem>
                  <SelectItem value="poor">Poor</SelectItem>
                  <SelectItem value="damaged">Damaged</SelectItem>
                  <SelectItem value="worn">Worn</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Damage/Wear Description</Label>
            <Textarea value={createForm.damageDescription} onChange={e => setCreateForm(p => ({ ...p, damageDescription: e.target.value }))} placeholder="Describe any damage or wear..." rows={2} />
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg border">
            <input type="checkbox" id="createRefurb" checked={createForm.refurbishmentNeeded} onChange={e => setCreateForm(p => ({ ...p, refurbishmentNeeded: e.target.checked }))} className="h-4 w-4" />
            <Label htmlFor="createRefurb">Needs Refurbishment</Label>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg border">
            <input type="checkbox" id="createConsumed" checked={createForm.isConsumed} onChange={e => setCreateForm(p => ({ ...p, isConsumed: e.target.checked }))} className="h-4 w-4" />
            <Label htmlFor="createConsumed">Part was consumed / non-reusable <span className="text-xs text-muted-foreground">(not eligible for refurbishment)</span></Label>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" disabled={submitting} onClick={handleCreate}>Submit Return</Button>
          </div>
        </div>
      </ResponsiveDialog>

      {/* Detail Sheet */}
      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="sm:max-w-lg w-full overflow-y-auto">
          {detailItem && (
            <>
              <SheetHeader className="mb-4">
                <SheetTitle className="flex items-center gap-2"><RefreshCw className="h-5 w-5 text-teal-600" /> {detailItem.returnNumber}</SheetTitle>
                <SheetDescription>{detailItem.itemName}</SheetDescription>
              </SheetHeader>
              <div className="px-4 pb-4">
              <Tabs defaultValue="details">
                <TabsList className="w-full"><TabsTrigger value="details" className="flex-1">Details</TabsTrigger><TabsTrigger value="timeline" className="flex-1">Timeline</TabsTrigger></TabsList>
                <TabsContent value="details" className="mt-4 space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label className="text-xs text-muted-foreground">Status</Label><div className="mt-1"><StatusBadge status={detailItem.status} /></div></div>
                    <div><Label className="text-xs text-muted-foreground">Condition</Label><p className="text-sm mt-1 capitalize">{detailItem.conditionOnReturn?.replace('_', ' ')}</p></div>
                    <div><Label className="text-xs text-muted-foreground">Quantity</Label><p className="text-sm mt-1 font-medium">{detailItem.quantity}</p></div>
                    <div><Label className="text-xs text-muted-foreground">WO #</Label><p className="text-sm mt-1 font-mono">{detailItem.workOrder?.woNumber}</p></div>
                    {detailItem.component && <div><Label className="text-xs text-muted-foreground">Component</Label><p className="text-sm mt-1">{detailItem.component.name} <span className="text-muted-foreground">({detailItem.component.componentCode})</span></p></div>}
                    {detailItem.installedSparePart && <div className="col-span-2"><Label className="text-xs text-muted-foreground">Physical source</Label><p className="text-sm mt-1">Installed part history · {detailItem.installedSparePart.partName}{detailItem.installedSparePart.serialNumber ? ` · SN ${detailItem.installedSparePart.serialNumber}` : ''}</p></div>}
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Refurbishment</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-muted/50 rounded-lg p-2 text-center">
                        <p className="text-sm font-medium">{detailItem.refurbishmentNeeded ? 'Yes' : 'No'}</p>
                        <p className="text-[10px] text-muted-foreground">Needed</p>
                      </div>
                      <div className="bg-muted/50 rounded-lg p-2 text-center">
                        <p className="text-sm font-medium">{detailItem.isConsumed ? 'Yes' : 'No'}</p>
                        <p className="text-[10px] text-muted-foreground">Consumed</p>
                      </div>
                      <div className="bg-muted/50 rounded-lg p-2 text-center">
                        <p className="text-sm font-medium">{detailItem.estimatedRefurbCost ? formatCurrency(detailItem.estimatedRefurbCost) : '—'}</p>
                        <p className="text-[10px] text-muted-foreground">Est. Cost</p>
                      </div>
                    </div>
                  </div>
                  {detailItem.damageDescription && (
                    <div className="space-y-1"><Label className="text-xs text-muted-foreground">Damage Description</Label><p className="text-sm bg-red-50 text-red-800 rounded-lg p-2">{detailItem.damageDescription}</p></div>
                  )}
                  {detailItem.inspectionNotes && (
                    <div className="space-y-1"><Label className="text-xs text-muted-foreground">Inspection Notes</Label><p className="text-sm bg-blue-50 text-blue-800 rounded-lg p-2">{detailItem.inspectionNotes}</p></div>
                  )}
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <div><Label className="text-xs text-muted-foreground">Returned By</Label><p className="text-sm mt-1">{detailItem.requestedBy?.fullName}</p></div>
                    <div><Label className="text-xs text-muted-foreground">Created</Label><p className="text-sm mt-1">{format(new Date(detailItem.createdAt), 'MMM d, yyyy')}</p></div>
                  </div>
                </TabsContent>
                <TabsContent value="timeline" className="mt-4">
                  <DetailTimeline events={[
                    { label: 'Part Returned', date: detailItem.createdAt, user: detailItem.requestedBy?.fullName },
                    { label: 'Inspected', date: detailItem.inspectedAt, user: detailItem.inspectedBy?.fullName, notes: detailItem.inspectionNotes },
                    { label: 'Refurbishment Started', date: detailItem.refurbishmentStart, user: detailItem.refurbisher?.fullName },
                    { label: 'Refurbishment Completed', date: detailItem.refurbishmentEnd, user: detailItem.refurbisher?.fullName },
                    { label: 'Returned to Store', date: detailItem.returnedToStoreAt, user: detailItem.returnedToStore?.fullName },
                    { label: 'Disposed', date: detailItem.disposedAt, user: detailItem.disposedByUser?.fullName, notes: detailItem.disposalReason },
                  ].filter(e => e.date)} />
                </TabsContent>
              </Tabs>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ============================================================================
// PAGE 9: DAMAGED TOOL REPORTS
// ============================================================================

const DAMAGE_STAGES: PipelineStage[] = [
  { key: 'reported', label: 'Reported', icon: AlertTriangle },
  { key: 'assessed', label: 'Assessed', icon: Search },
  { key: 'repair_quoted', label: 'Quoted', icon: DollarSign },
  { key: 'repair_in_progress', label: 'Repairing', icon: Wrench },
  { key: 'awaiting_qc', label: 'Awaiting QC', icon: ShieldCheck },
  { key: 'repaired', label: 'Repaired', icon: CheckCircle2 },
  { key: 'written_off', label: 'Written Off', icon: Ban },
];

export function DamagedToolReportsPage() {
  const { user, hasPermission, isAdmin } = useAuthStore();
  const repairsEnabled = useModuleEnabled(MODULE_CODES.REPAIRS);
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any>(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<{ page: number; totalPages: number; total: number } | null>(null);
  const [detailItem, setDetailItem] = useState<any>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [createForm, setCreateForm] = useState({
    toolId: '', workOrderId: '', damageType: 'broken', damageSeverity: 'medium',
    damageDescription: '', occurredAt: '', technicianId: '', quantity: '1',
  });
  const [actionOpen, setActionOpen] = useState(false);
  const [actionTarget, setActionTarget] = useState<{ id: string; action: string } | null>(null);
  const [actionForm, setActionForm] = useState({ notes: '', estimatedCost: '', vendorName: '', reason: '' });
  const canAcceptRepairQC = isAdmin() || Boolean(user?.roles?.some((role: any) => ['store_keeper', 'inventory_manager', 'tools_shop_attendant'].includes(role.slug)));

  const fetchReports = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterStatus !== 'all') params.set('status', filterStatus);
    params.set('page', String(page));
    params.set('limit', '20');
    const [listRes, statsRes] = await Promise.all([
      api.get(`/api/repairs/damaged-tools?${params}`),
      api.get('/api/repairs/damaged-tools?stats=true'),
    ]);
    if (listRes.success) { setReports(listRes.data || []); if (listRes.pagination) setPagination(listRes.pagination); }
    if (statsRes.success) setStats(statsRes.data);
    setLoading(false);
  }, [filterStatus, page]);

  useEffect(() => { fetchReports(); }, [fetchReports]);

  const handleCreate = async () => {
    if (!createForm.toolId || !createForm.damageDescription) { toast.error('Tool and damage description are required'); return; }
    setSubmitting(true);
    const res = await api.post('/api/repairs/damaged-tools', {
      toolId: createForm.toolId, workOrderId: createForm.workOrderId || undefined,
      damageType: createForm.damageType, damageSeverity: createForm.damageSeverity,
      damageDescription: createForm.damageDescription, quantity: parseInt(createForm.quantity, 10) || 1,
      occurredAt: createForm.occurredAt || undefined, technicianId: createForm.technicianId || undefined,
    });
    if (res.success) {
      toast.success('Damaged tool report created'); setCreateOpen(false);
      setCreateForm({ toolId: '', workOrderId: '', damageType: 'broken', damageSeverity: 'medium', damageDescription: '', occurredAt: '', technicianId: '', quantity: '1' });
      fetchReports();
    } else toast.error(res.error || 'Failed');
    setSubmitting(false);
  };

  const handleAction = async (id: string, action: string, extra?: Record<string, any>) => {
    setSubmitting(true);
    const res = await api.post(`/api/repairs/damaged-tools/${id}`, { action, ...extra });
    if (res.success) { toast.success('Action completed'); fetchReports(); if (detailOpen && detailItem?.id === id) setDetailOpen(false); setActionOpen(false); }
    else toast.error(res.error || 'Failed');
    setSubmitting(false);
  };

  const filtered = useMemo(() => reports.filter(r =>
    !searchText || r.tool?.name?.toLowerCase().includes(searchText.toLowerCase()) || r.reportNumber?.toLowerCase().includes(searchText.toLowerCase()) || r.damageDescription?.toLowerCase().includes(searchText.toLowerCase())
  ), [reports, searchText]);

  if (!repairsEnabled) {
    return (<div className="flex items-center justify-center h-96"><div className="text-center"><p className="text-muted-foreground">Repairs module is not active.</p><p className="text-sm text-muted-foreground mt-1">Enable it in Settings → Modules.</p></div></div>);
  }

  return (
    <div className="page-content">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-red-100 rounded-xl"><AlertTriangle className="h-6 w-6 text-red-700" /></div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold tracking-tight">Damaged Tool Reports</h2>
              <Badge variant="secondary" className="font-mono">{reports.length}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">Report and track damaged tools with repair lifecycle</p>
          </div>
        </div>
        {(user && (hasPermission('damaged_tool_reports.create') || isAdmin())) && <Button onClick={() => setCreateOpen(true)} className="gap-2"><Plus className="h-4 w-4" /> Report Damage</Button>}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard icon={AlertTriangle} count={stats?.byStatus?.reported ?? 0} label="Reported" color="text-red-600" bgColor="bg-red-50" onClick={() => { setFilterStatus('reported'); setPage(1); }} />
        <StatsCard icon={Wrench} count={stats?.byStatus?.repair_in_progress ?? 0} label="In Repair" color="text-blue-600" bgColor="bg-blue-50" onClick={() => { setFilterStatus('repair_in_progress'); setPage(1); }} />
        <StatsCard icon={ShieldCheck} count={stats?.byStatus?.awaiting_qc ?? 0} label="Awaiting QC" color="text-violet-600" bgColor="bg-violet-50" onClick={() => { setFilterStatus('awaiting_qc'); setPage(1); }} />
        <StatsCard icon={CheckCircle2} count={stats?.byStatus?.repaired ?? 0} label="Repaired" color="text-emerald-600" bgColor="bg-emerald-50" onClick={() => { setFilterStatus('repaired'); setPage(1); }} />
        <StatsCard icon={Ban} count={stats?.byStatus?.written_off ?? 0} label="Written Off" color="text-gray-600" bgColor="bg-gray-50" onClick={() => { setFilterStatus('written_off'); setPage(1); }} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search tools, reports..." value={searchText} onChange={(e) => setSearchText(e.target.value)} className="pl-9" />
        </div>
        <Select value={filterStatus} onValueChange={(v) => { setFilterStatus(v); setPage(1); }}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="reported">Reported</SelectItem>
            <SelectItem value="assessed">Assessed</SelectItem>
            <SelectItem value="repair_quoted">Quoted</SelectItem>
            <SelectItem value="repair_in_progress">In Repair</SelectItem>
            <SelectItem value="awaiting_qc">Awaiting QC</SelectItem>
            <SelectItem value="repaired">Repaired</SelectItem>
            <SelectItem value="written_off">Written Off</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {loading ? <LoadingSkeleton /> : filtered.length === 0 ? (
            <EmptyState icon={AlertTriangle} title="No damaged tool reports" description="Report tool damage to track repairs and replacements" />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Report #</TableHead>
                    <TableHead>Tool</TableHead>
                    <TableHead>Damage</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>WO #</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow key={r.id} className="cursor-pointer hover:bg-muted/30" onClick={() => { setDetailItem(r); setDetailOpen(true); }}>
                      <TableCell><Badge variant="outline" className="font-mono text-xs">{r.reportNumber}</Badge></TableCell>
                      <TableCell>
                        <div className="font-medium text-sm">{r.tool?.name}</div>
                        <div className="text-xs text-muted-foreground">{r.tool?.toolCode}</div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">{r.damageType?.replace('_', ' ')}</div>
                        <div className="text-xs text-muted-foreground truncate max-w-[150px]">{r.damageDescription}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={r.damageSeverity === 'critical' ? 'bg-red-100 text-red-800' : r.damageSeverity === 'high' ? 'bg-orange-100 text-orange-800' : r.damageSeverity === 'medium' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'}>
                          {r.damageSeverity}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <StatusBadge status={r.status} />
                          <MiniPipeline stages={DAMAGE_STAGES} currentStatus={r.status} />
                        </div>
                      </TableCell>
                      <TableCell>{r.workOrder?.woNumber ? <Badge variant="outline" className="font-mono text-xs">{r.workOrder.woNumber}</Badge> : '—'}</TableCell>
                      <TableCell><OverduePulse isOverdue={false} date={r.createdAt} /></TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                          {r.status === 'reported' && (isAdmin() || hasPermission('damaged_tool_reports.update')) && (
                            <Button size="sm" className="h-7 gap-1 bg-blue-600 hover:bg-blue-700 text-white" onClick={() => { setActionTarget({ id: r.id, action: 'assess' }); setActionForm({ notes: '', estimatedCost: '', vendorName: '', reason: '' }); setActionOpen(true); }}>
                              <Search className="h-3.5 w-3.5" /> Assess
                            </Button>
                          )}
                          {r.status === 'assessed' && canAcceptRepairQC && (
                            <Button size="sm" className="h-7 gap-1 bg-violet-600 hover:bg-violet-700 text-white" onClick={() => { setActionTarget({ id: r.id, action: 'quote_repair' }); setActionForm({ notes: '', estimatedCost: r.estimatedRepairCost ? String(r.estimatedRepairCost) : '', vendorName: '', reason: '' }); setActionOpen(true); }}>
                              <DollarSign className="h-3.5 w-3.5" /> Quote Repair
                            </Button>
                          )}
                          {r.status === 'repair_quoted' && (isAdmin() || hasPermission('damaged_tool_reports.update')) && (
                            <Button size="sm" className="h-7 gap-1 bg-blue-600 hover:bg-blue-700 text-white" onClick={() => handleAction(r.id, 'start_repair')}>
                              <Wrench className="h-3.5 w-3.5" /> Start Repair
                            </Button>
                          )}
                          {r.status === 'repair_in_progress' && (isAdmin() || hasPermission('damaged_tool_reports.update')) && (
                            <Button size="sm" className="h-7 gap-1 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => handleAction(r.id, 'complete_repair')}>
                              <CheckCircle2 className="h-3.5 w-3.5" /> Complete
                            </Button>
                          )}
                          {r.status === 'awaiting_qc' && canAcceptRepairQC && (
                            <Button size="sm" className="h-7 gap-1 bg-violet-600 hover:bg-violet-700 text-white" onClick={() => { setActionTarget({ id: r.id, action: 'accept_repair' }); setActionForm({ notes: '', estimatedCost: '', vendorName: '', reason: '' }); setActionOpen(true); }}>
                              <ShieldCheck className="h-3.5 w-3.5" /> Accept QC
                            </Button>
                          )}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7"><MoreHorizontal className="h-3.5 w-3.5" /></Button></DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => { setDetailItem(r); setDetailOpen(true); }}><Eye className="h-4 w-4 mr-2" /> View</DropdownMenuItem>
                              {(isAdmin() || hasPermission('damaged_tool_reports.update')) && !['repaired', 'written_off', 'replaced'].includes(r.status) && (
                                <DropdownMenuItem className="text-red-600" onClick={() => { setActionTarget({ id: r.id, action: 'write_off' }); setActionForm({ notes: '', estimatedCost: '', vendorName: '', reason: '' }); setActionOpen(true); }}><Ban className="h-4 w-4 mr-2" /> Write Off</DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Action Dialog */}
      <ResponsiveDialog open={actionOpen} onOpenChange={setActionOpen}>
        {actionTarget?.action === 'assess' && (
          <>
            <div className="space-y-1.5 mb-4"><h2 className="text-lg font-semibold">Assess Damage</h2><p className="text-sm text-muted-foreground">Evaluate damage and estimate repair cost.</p></div>
            <div className="space-y-3">
              <div className="space-y-2"><Label>Estimated Repair Cost</Label><Input type="number" value={actionForm.estimatedCost} onChange={e => setActionForm(p => ({ ...p, estimatedCost: e.target.value }))} placeholder="0.00" /></div>
              <div className="space-y-2"><Label>Assessment Notes</Label><Textarea value={actionForm.notes} onChange={e => setActionForm(p => ({ ...p, notes: e.target.value }))} rows={3} /></div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="outline" onClick={() => setActionOpen(false)}>Cancel</Button>
                <Button className="bg-blue-600 hover:bg-blue-700 text-white" disabled={submitting} onClick={() => handleAction(actionTarget.id, 'assess', { assessmentNotes: actionForm.notes, estimatedRepairCost: actionForm.estimatedCost ? parseFloat(actionForm.estimatedCost) : undefined })}>Submit Assessment</Button>
              </div>
            </div>
          </>
        )}
        {actionTarget?.action === 'quote_repair' && (
          <>
            <div className="space-y-1.5 mb-4"><h2 className="text-lg font-semibold">Quote Repair</h2><p className="text-sm text-muted-foreground">Record the repair vendor and estimated cost before work starts.</p></div>
            <div className="space-y-3">
              <div className="space-y-2"><Label>Repair Vendor</Label><Input value={actionForm.vendorName} onChange={e => setActionForm(p => ({ ...p, vendorName: e.target.value }))} placeholder="Vendor or in-house" /></div>
              <div className="space-y-2"><Label>Estimated Repair Cost</Label><Input type="number" min="0" step="0.01" value={actionForm.estimatedCost} onChange={e => setActionForm(p => ({ ...p, estimatedCost: e.target.value }))} placeholder="0.00" /></div>
              <div className="space-y-2"><Label>Notes</Label><Textarea value={actionForm.notes} onChange={e => setActionForm(p => ({ ...p, notes: e.target.value }))} rows={2} /></div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="outline" onClick={() => setActionOpen(false)}>Cancel</Button>
                <Button className="bg-violet-600 hover:bg-violet-700 text-white" disabled={submitting} onClick={() => handleAction(actionTarget.id, 'quote_repair', { repairVendorName: actionForm.vendorName || undefined, estimatedRepairCost: actionForm.estimatedCost ? parseFloat(actionForm.estimatedCost) : undefined })}>Save Quote</Button>
              </div>
            </div>
          </>
        )}
        {actionTarget?.action === 'accept_repair' && (
          <>
            <div className="space-y-1.5 mb-4"><h2 className="text-lg font-semibold">Accept Repaired Tool</h2><p className="text-sm text-muted-foreground">Confirm functional inspection/QC before returning repaired quantity to usable tool stock.</p></div>
            <div className="space-y-3">
              <div className="space-y-2"><Label htmlFor="damaged-tool-qc-notes">QC Notes</Label><Textarea id="damaged-tool-qc-notes" value={actionForm.notes} onChange={e => setActionForm(p => ({ ...p, notes: e.target.value }))} rows={3} placeholder="Functional test, inspection result, calibration check..." /></div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="outline" onClick={() => setActionOpen(false)}>Cancel</Button>
                <Button className="bg-violet-600 hover:bg-violet-700 text-white" disabled={submitting} onClick={() => handleAction(actionTarget.id, 'accept_repair', { qcNotes: actionForm.notes || undefined })}><ShieldCheck className="h-4 w-4 mr-2" />Accept QC</Button>
              </div>
            </div>
          </>
        )}
        {actionTarget?.action === 'write_off' && (
          <>
            <div className="space-y-1.5 mb-4"><h2 className="text-lg font-semibold text-red-600">Write Off Tool</h2><p className="text-sm text-muted-foreground">This will mark the tool as retired and unrepairable.</p></div>
            <div className="space-y-3">
              <div className="space-y-2"><Label>Write-Off Reason *</Label><Textarea value={actionForm.reason} onChange={e => setActionForm(p => ({ ...p, reason: e.target.value }))} rows={3} /></div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="outline" onClick={() => setActionOpen(false)}>Cancel</Button>
                <Button variant="destructive" disabled={submitting || !actionForm.reason} onClick={() => handleAction(actionTarget.id, 'write_off', { writeOffReason: actionForm.reason })}>Write Off</Button>
              </div>
            </div>
          </>
        )}
      </ResponsiveDialog>

      {/* Create Dialog */}
      <ResponsiveDialog open={createOpen} onOpenChange={setCreateOpen}>
        <div className="space-y-1.5 mb-4"><h2 className="text-lg font-semibold">Report Damaged Tool</h2><p className="text-sm text-muted-foreground">Document tool damage for tracking and repair.</p></div>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Tool *</Label>
            <AsyncSearchableSelect placeholder="Search tool..." fetchOptions={async (q) => {
              const res = await api.get(`/api/tools?mode=lookup&search=${q}&limit=20`);
              if (res.success) return (res.data || []).map((t: any) => ({ value: t.id, label: `${t.toolCode} - ${t.name}` }));
              return [];
            }} value={createForm.toolId} onValueChange={v => setCreateForm(p => ({ ...p, toolId: v }))} />
          </div>
          <div className="space-y-2">
            <Label>Work Order (if related)</Label>
            <AsyncSearchableSelect placeholder="Search work order..." fetchOptions={async (q) => {
              const res = await api.get(`/api/work-orders?search=${q}&limit=20`);
              if (res.success) return (res.data || []).map((wo: any) => ({ value: wo.id, label: `${wo.woNumber} - ${wo.title}` }));
              return [];
            }} value={createForm.workOrderId} onValueChange={v => setCreateForm(p => ({ ...p, workOrderId: v }))} />
          </div>
          <div className="space-y-2">
            <Label>Damaged Quantity *</Label>
            <Input type="number" min="1" step="1" value={createForm.quantity} onChange={e => setCreateForm(p => ({ ...p, quantity: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Damage Type *</Label>
              <Select value={createForm.damageType} onValueChange={v => setCreateForm(p => ({ ...p, damageType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="broken">Broken</SelectItem>
                  <SelectItem value="worn">Worn</SelectItem>
                  <SelectItem value="malfunctioning">Malfunctioning</SelectItem>
                  <SelectItem value="missing_parts">Missing Parts</SelectItem>
                  <SelectItem value="cosmetic">Cosmetic</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Severity *</Label>
              <Select value={createForm.damageSeverity} onValueChange={v => setCreateForm(p => ({ ...p, damageSeverity: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Damage Description *</Label>
            <Textarea value={createForm.damageDescription} onChange={e => setCreateForm(p => ({ ...p, damageDescription: e.target.value }))} placeholder="Describe the damage..." rows={3} />
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button className="bg-red-600 hover:bg-red-700 text-white" disabled={submitting} onClick={handleCreate}>Submit Report</Button>
          </div>
        </div>
      </ResponsiveDialog>

      {/* Detail Sheet */}
      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="sm:max-w-lg w-full overflow-y-auto">
          {detailItem && (
            <>
              <SheetHeader className="mb-4">
                <SheetTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-red-600" /> {detailItem.reportNumber}</SheetTitle>
                <SheetDescription>{detailItem.tool?.name} — {detailItem.tool?.toolCode}</SheetDescription>
              </SheetHeader>
              <div className="px-4 pb-4">
              <Tabs defaultValue="details">
                <TabsList className="w-full"><TabsTrigger value="details" className="flex-1">Details</TabsTrigger><TabsTrigger value="timeline" className="flex-1">Timeline</TabsTrigger></TabsList>
                <TabsContent value="details" className="mt-4 space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label className="text-xs text-muted-foreground">Status</Label><div className="mt-1"><StatusBadge status={detailItem.status} /></div></div>
                    <div><Label className="text-xs text-muted-foreground">Severity</Label><div className="mt-1"><Badge variant="outline" className={detailItem.damageSeverity === 'critical' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}>{detailItem.damageSeverity}</Badge></div></div>
                    <div><Label className="text-xs text-muted-foreground">Damage Type</Label><p className="text-sm mt-1 capitalize">{detailItem.damageType?.replace('_', ' ')}</p></div>
                    <div><Label className="text-xs text-muted-foreground">WO #</Label><p className="text-sm mt-1 font-mono">{detailItem.workOrder?.woNumber || '—'}</p></div>
                  </div>
                  <Separator />
                  <div><Label className="text-xs text-muted-foreground">Damage Description</Label><p className="text-sm mt-1 bg-red-50 text-red-900 rounded-lg p-3">{detailItem.damageDescription}</p></div>
                  {detailItem.assessmentNotes && <div><Label className="text-xs text-muted-foreground">Assessment</Label><p className="text-sm mt-1 bg-blue-50 text-blue-900 rounded-lg p-3">{detailItem.assessmentNotes}</p></div>}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-muted/50 rounded-lg p-3 text-center"><p className="text-lg font-bold">{detailItem.estimatedRepairCost ? formatCurrency(detailItem.estimatedRepairCost) : '—'}</p><p className="text-[10px] text-muted-foreground">Est. Cost</p></div>
                    <div className="bg-muted/50 rounded-lg p-3 text-center"><p className="text-lg font-bold">{detailItem.actualRepairCost ? formatCurrency(detailItem.actualRepairCost) : '—'}</p><p className="text-[10px] text-muted-foreground">Actual Cost</p></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <div><Label className="text-xs text-muted-foreground">Reported By</Label><p className="text-sm mt-1">{detailItem.reportedBy?.fullName}</p></div>
                    <div><Label className="text-xs text-muted-foreground">Technician</Label><p className="text-sm mt-1">{detailItem.technician?.fullName || '—'}</p></div>
                  </div>
                </TabsContent>
                <TabsContent value="timeline" className="mt-4">
                  <DetailTimeline events={[
                    { label: 'Damage Reported', date: detailItem.createdAt, user: detailItem.reportedBy?.fullName },
                    { label: 'Assessed', date: detailItem.assessedAt, notes: detailItem.assessmentNotes },
                    { label: 'Repair Started', date: detailItem.repairStartedAt },
                    { label: 'Repair Completed', date: detailItem.repairCompletedAt },
                    { label: 'QC Accepted', date: detailItem.qcAcceptedAt, notes: detailItem.qcNotes },
                    { label: 'Written Off', date: detailItem.writtenOffAt, notes: detailItem.writeOffReason },
                  ].filter(e => e.date)} />
                </TabsContent>
              </Tabs>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ============================================================================
// PAGE 10: MAINTENANCE LIFECYCLE REPORTS
// ============================================================================

export function MaintenanceReportsPage() {
  const { user } = useAuthStore();
  const repairsEnabled = useModuleEnabled(MODULE_CODES.REPAIRS);
  const [reportType, setReportType] = useState('lifecycle');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [plantFilter, setPlantFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [reportData, setReportData] = useState<any>(null);
  const [reportGenerated, setReportGenerated] = useState(false);

  const REPORT_TYPES = [
    { value: 'lifecycle', label: 'Full Lifecycle', icon: Activity, description: 'MR → WO end-to-end turnaround analysis' },
    { value: 'execution', label: 'WO Execution', icon: ClipboardList, description: 'Completion rates, actual vs estimated hours, rework' },
    { value: 'technician_performance', label: 'Technician Performance', icon: User, description: 'Per-technician WO completion, time accuracy, rework' },
    { value: 'materials', label: 'Materials & Parts', icon: Package, description: 'Material usage, reconciliation, spare part returns' },
    { value: 'downtime', label: 'Downtime Analysis', icon: Timer, description: 'Equipment downtime by asset, category, impact' },
    { value: 'tools', label: 'Tool Management', icon: Wrench, description: 'Damage rates, repair costs, transfers' },
  ];

  const generateReport = async () => {
    setLoading(true);
    const params = new URLSearchParams({ type: reportType });
    if (dateFrom) params.set('from', dateFrom);
    if (dateTo) params.set('to', dateTo);
    if (plantFilter) params.set('plantId', plantFilter);
    const res = await api.get(`/api/repairs/reports?${params}`);
    if (res.success) { setReportData(res.data); setReportGenerated(true); }
    else toast.error(res.error || 'Failed to generate report');
    setLoading(false);
  };

  const exportCSV = () => {
    if (!reportData) return;
    const type = reportType;
    let csvContent = '';
    if (type === 'technician_performance' && reportData.technicians) {
      csvContent = 'Technician,WO Completed,Avg Hours/WO,Rework Rate,Total Hours\n' +
        reportData.technicians.map((t: any) =>
          `"${t.name}",${t.woCount},${t.avgHoursPerWo},${t.reworkRate}%,${t.totalHours}`
        ).join('\n');
    } else if (type === 'execution') {
      csvContent = 'Metric,Value\n' + Object.entries(reportData).map(([k, v]: [string, any]) =>
        `${k},${typeof v === 'object' ? JSON.stringify(v) : v}`
      ).join('\n');
    } else if (type === 'downtime' && reportData.byAsset) {
      csvContent = 'Asset,Total Downtime (min),Avg Duration,Incidents,Production Loss\n' +
        reportData.byAsset.map((a: any) =>
          `"${a.assetName}",${a.totalDowntime},${a.avgDuration},${a.incidentCount},${a.totalProductionLoss || 0}`
        ).join('\n');
    } else {
      csvContent = 'Key,Value\n' + Object.entries(reportData).map(([k, v]: [string, any]) =>
        `"${k}",${typeof v === 'object' ? JSON.stringify(v) : v}`
      ).join('\n');
    }
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `maintenance-report-${type}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click(); URL.revokeObjectURL(url);
    toast.success('Report exported');
  };

  if (!repairsEnabled) {
    return (<div className="flex items-center justify-center h-96"><div className="text-center"><p className="text-muted-foreground">Repairs module is not active.</p><p className="text-sm text-muted-foreground mt-1">Enable it in Settings → Modules.</p></div></div>);
  }

  return (
    <div className="page-content">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-100 rounded-xl"><BarChart3 className="h-6 w-6 text-emerald-700" /></div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Repair Lifecycle</h2>
            <p className="text-sm text-muted-foreground">MR → WO end-to-end turnaround analytics</p>
          </div>
        </div>
        {reportGenerated && reportData && (
          <Button variant="outline" onClick={exportCSV} className="gap-2"><DollarSign className="h-4 w-4" /> Export CSV</Button>
        )}
      </div>

      {/* Report Type Selection */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {REPORT_TYPES.map(rt => (
          <button key={rt.value} onClick={() => { setReportType(rt.value); setReportGenerated(false); }}
            className={`p-4 rounded-lg border-2 text-left transition-all ${reportType === rt.value ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200' : 'border-gray-200 hover:border-gray-300 hover:bg-muted/30'}`}>
            <div className="flex items-center gap-2 mb-1">
              <rt.icon className={`h-4 w-4 ${reportType === rt.value ? 'text-emerald-600' : 'text-gray-500'}`} />
              <span className="text-sm font-semibold">{rt.label}</span>
            </div>
            <p className="text-xs text-muted-foreground">{rt.description}</p>
          </button>
        ))}
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <DateRangePicker label="Date Range" from={dateFrom || undefined} to={dateTo || undefined} onChange={(f, t) => { setDateFrom(f || ''); setDateTo(t || ''); }} />
          <Button onClick={generateReport} disabled={loading} className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white">
            {loading ? <Activity className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}
            Generate Report
          </Button>
        </div>
      </Card>

      {/* Report Display */}
      {loading && <LoadingSkeleton />}
      {reportGenerated && reportData && (
        <div className="space-y-4">
          {/* Lifecycle Report */}
          {reportType === 'lifecycle' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatsCard icon={Clock} count={reportData.totalRequests ?? 0} label="Total MRs" color="text-blue-600" bgColor="bg-blue-50" />
                <StatsCard icon={CheckCircle2} count={reportData.convertedToWO ?? 0} label="Converted to WO" color="text-emerald-600" bgColor="bg-emerald-50" />
                <StatsCard icon={Timer} count={formatDuration(reportData.avgTurnaroundHours ?? 0)} label="Avg Turnaround" color="text-teal-600" bgColor="bg-teal-50" />
                <StatsCard icon={TrendingUp} count={formatDuration(reportData.avgMrToWoHours ?? 0)} label="MR→WO Time" color="text-amber-600" bgColor="bg-amber-50" />
              </div>
              {Array.isArray(reportData.stageBreakdown) && reportData.stageBreakdown.length > 0 && (
                <Card><CardHeader><CardTitle className="text-base">Stage Breakdown</CardTitle></CardHeader><CardContent>
                  <div className="space-y-3">
                    {reportData.stageBreakdown.map((stage: any, i: number) => (
                      <div key={i} className="flex items-center gap-3">
                        <div className="w-40 text-sm font-medium truncate">{stage.name}</div>
                        <div className="flex-1"><Progress value={Math.min(100, (stage.avgHours / (reportData.avgTurnaroundHours || 1)) * 100)} className="h-3" /></div>
                        <div className="w-20 text-sm text-right text-muted-foreground">{formatDuration(stage.avgHours || 0)} avg</div>
                        <div className="w-16 text-sm text-right text-muted-foreground">{stage.count} items</div>
                      </div>
                    ))}
                  </div>
                </CardContent></Card>
              )}
              {reportData.priorityBreakdown && (
                <Card><CardHeader><CardTitle className="text-base">By Priority</CardTitle></CardHeader><CardContent>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {Object.entries(reportData.priorityBreakdown).map(([key, val]: [string, any]) => (
                      <div key={key} className="bg-muted/50 rounded-lg p-3 text-center">
                        <p className="text-2xl font-bold">{val.count || 0}</p>
                        <p className="text-xs text-muted-foreground capitalize">{key} ({formatDuration(val.avgHours || 0)} avg)</p>
                      </div>
                    ))}
                  </div>
                </CardContent></Card>
              )}
            </div>
          )}

          {/* Execution Report */}
          {reportType === 'execution' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatsCard icon={ClipboardList} count={reportData.totalWOs ?? 0} label="Total WOs" color="text-blue-600" bgColor="bg-blue-50" />
                <StatsCard icon={CheckCircle2} count={`${reportData.completionRate ?? 0}%`} label="Completion Rate" color="text-emerald-600" bgColor="bg-emerald-50" />
                <StatsCard icon={Timer} count={formatDuration(reportData.avgActualHours ?? 0)} label="Avg Actual Hours" color="text-teal-600" bgColor="bg-teal-50" />
                <StatsCard icon={AlertTriangle} count={`${reportData.reworkRate ?? 0}%`} label="Rework Rate" color="text-red-600" bgColor="bg-red-50" />
              </div>
              {Array.isArray(reportData.byType) && reportData.byType.length > 0 && (
                <Card><CardHeader><CardTitle className="text-base">By Work Order Type</CardTitle></CardHeader><CardContent>
                  <div className="space-y-3">
                    {reportData.byType.map((t: any) => (
                      <div key={t.type} className="flex items-center gap-4">
                        <div className="w-32 text-sm font-medium capitalize">{t.type?.replace('_', ' ')}</div>
                        <div className="flex-1"><Progress value={t.count ? (t.count / reportData.totalWOs) * 100 : 0} className="h-3" /></div>
                        <div className="w-20 text-sm text-right">{t.count} WOs</div>
                        <div className="w-24 text-sm text-right text-muted-foreground">{formatDuration(t.avgHours || 0)} avg</div>
                      </div>
                    ))}
                  </div>
                </CardContent></Card>
              )}
            </div>
          )}

          {/* Technician Performance Report */}
          {reportType === 'technician_performance' && (
            <div className="space-y-4">
              {reportData.technicians && reportData.technicians.length > 0 ? (
                <Card><CardHeader><CardTitle className="text-base">Technician Performance</CardTitle></CardHeader><CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead>Technician</TableHead>
                        <TableHead className="text-center">WOs Completed</TableHead>
                        <TableHead className="text-center">Avg Hours/WO</TableHead>
                        <TableHead className="text-center">Total Hours</TableHead>
                        <TableHead className="text-center">Rework Rate</TableHead>
                        <TableHead className="text-center">On-Time Rate</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reportData.technicians.map((t: any) => (
                        <TableRow key={t.userId || t.user?.id}>
                          <TableCell><div className="flex items-center gap-2"><AvatarPlaceholder name={t.user?.fullName || t.name || 'Unknown'} /><span className="font-medium text-sm">{t.user?.fullName || t.name || 'Unknown'}</span></div></TableCell>
                          <TableCell className="text-center font-medium">{t.closedCount ?? t.woCount ?? 0}</TableCell>
                          <TableCell className="text-center">{formatDuration(t.avgTimePerWo || t.avgHoursPerWo || 0)}</TableCell>
                          <TableCell className="text-center">{formatDuration(t.totalTimeLogged || t.totalHours || 0)}</TableCell>
                          <TableCell className="text-center">
                            <Badge variant="outline" className={t.reworkRate > 10 ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800'}>{t.reworkRate ?? 0}%</Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant="outline" className={(t.timeAccuracy ?? t.onTimeRate ?? 0) >= 80 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}>{t.timeAccuracy ?? t.onTimeRate ?? 0}%</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent></Card>
              ) : (
                <Card><CardContent className="py-12"><EmptyState icon={User} title="No data" description="No technician performance data for the selected period" /></CardContent></Card>
              )}
            </div>
          )}

          {/* Materials Report */}
          {reportType === 'materials' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatsCard icon={Package} count={reportData.totalMaterialCost ? formatCurrency(reportData.totalMaterialCost) : '₵0'} label="Total Material Cost" color="text-amber-600" bgColor="bg-amber-50" />
                <StatsCard icon={RefreshCw} count={reportData.sparePartReturns?.total ?? 0} label="Parts Returned" color="text-teal-600" bgColor="bg-teal-50" />
                <StatsCard icon={AlertTriangle} count={`${reportData.wasteRate ?? 0}%`} label="Waste Rate" color="text-red-600" bgColor="bg-red-50" />
                <StatsCard icon={DollarSign} count={reportData.savingsFromReturns ? formatCurrency(reportData.savingsFromReturns) : '₵0'} label="Return Savings" color="text-emerald-600" bgColor="bg-emerald-50" />
              </div>
              {reportData.byItem && (
                <Card><CardHeader><CardTitle className="text-base">Top Materials by Usage</CardTitle></CardHeader><CardContent>
                  <div className="space-y-2">
                    {reportData.byItem.slice(0, 10).map((item: any, i: number) => (
                      <div key={i} className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground w-5">{i + 1}.</span>
                        <span className="flex-1 text-sm font-medium truncate">{item.itemName}</span>
                        <span className="text-sm">{item.totalQty}</span>
                        <span className="text-sm font-medium w-24 text-right">{formatCurrency(item.totalCost || 0)}</span>
                      </div>
                    ))}
                  </div>
                </CardContent></Card>
              )}
            </div>
          )}

          {/* Downtime Report */}
          {reportType === 'downtime' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatsCard icon={Timer} count={`${reportData.totalDowntimeMinutes ?? 0}m`} label="Total Downtime" color="text-red-600" bgColor="bg-red-50" />
                <StatsCard icon={Activity} count={`${reportData.avgDurationMinutes ?? 0}m`} label="Avg Duration" color="text-amber-600" bgColor="bg-amber-50" />
                <StatsCard icon={DollarSign} count={reportData.totalProductionLoss ? formatCurrency(reportData.totalProductionLoss) : '₵0'} label="Production Loss" color="text-orange-600" bgColor="bg-orange-50" />
                <StatsCard icon={TrendingUp} count={reportData.incidentCount ?? 0} label="Incidents" color="text-blue-600" bgColor="bg-blue-50" />
              </div>
              {reportData.byAsset && (
                <Card><CardHeader><CardTitle className="text-base">Downtime by Asset</CardTitle></CardHeader><CardContent className="p-0">
                  <Table>
                    <TableHeader><TableRow className="bg-muted/50">
                      <TableHead>Asset</TableHead><TableHead className="text-center">Incidents</TableHead><TableHead className="text-center">Total (min)</TableHead><TableHead className="text-center">Avg (min)</TableHead><TableHead className="text-right">Production Loss</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {reportData.byAsset.slice(0, 15).map((a: any, i: number) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium text-sm">{a.assetName}</TableCell>
                          <TableCell className="text-center">{a.incidentCount}</TableCell>
                          <TableCell className="text-center">{a.totalDowntime}</TableCell>
                          <TableCell className="text-center">{a.avgDuration?.toFixed(0)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(a.totalProductionLoss || 0)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent></Card>
              )}
            </div>
          )}

          {/* Tools Report */}
          {reportType === 'tools' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatsCard icon={AlertTriangle} count={reportData.totalDamageReports ?? 0} label="Damage Reports" color="text-red-600" bgColor="bg-red-50" />
                <StatsCard icon={Wrench} count={reportData.totalRepairCost ? formatCurrency(reportData.totalRepairCost) : '₵0'} label="Total Repair Cost" color="text-amber-600" bgColor="bg-amber-50" />
                <StatsCard icon={ArrowRightLeft} count={reportData.totalTransfers ?? 0} label="Tool Transfers" color="text-blue-600" bgColor="bg-blue-50" />
                <StatsCard icon={Ban} count={reportData.totalWrittenOff ?? 0} label="Written Off" color="text-gray-600" bgColor="bg-gray-50" />
              </div>
              {reportData.byDamageType && Object.keys(reportData.byDamageType as Record<string, unknown>).length > 0 && (
                <Card><CardHeader><CardTitle className="text-base">By Damage Type</CardTitle></CardHeader><CardContent>
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                    {Object.entries(reportData.byDamageType as Record<string, any>).map(([type, d]) => (
                      <div key={type} className="bg-muted/50 rounded-lg p-3">
                        <p className="text-lg font-bold capitalize">{type?.replace('_', ' ')}</p>
                        <p className="text-xs text-muted-foreground">{d.count} incidents, {formatCurrency(d.cost)}</p>
                      </div>
                    ))}
                  </div>
                </CardContent></Card>
              )}
            </div>
          )}
        </div>
      )}

      {!reportGenerated && !loading && (
        <Card><CardContent className="py-16">
          <div className="text-center">
            <BarChart3 className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-semibold text-muted-foreground">Select a report type and generate</h3>
            <p className="text-sm text-muted-foreground mt-1">Choose from lifecycle, execution, technician, materials, downtime, or tools reports</p>
          </div>
        </CardContent></Card>
      )}
    </div>
  );
}
