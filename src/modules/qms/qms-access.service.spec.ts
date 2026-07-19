import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { QmsAccessService } from './qms-access.service';
describe('QmsAccessService',()=>{
 const prisma:any={employee:{findUnique:jest.fn()}},service=new QmsAccessService(prisma),user:any={id:'e1',role:Role.EMPLOYEE};
 beforeEach(()=>jest.clearAllMocks());
 it('allows an active QC Inspector to execute QMS work without approval',async()=>{prisma.employee.findUnique.mockResolvedValue({status:'ACTIVE',isQcInspector:true,isQmsHead:false});await expect(service.assertUser(user)).resolves.toBeUndefined();await expect(service.assertHead(user)).rejects.toBeInstanceOf(ForbiddenException);});
 it('allows only an explicitly designated QMS Head to approve',async()=>{prisma.employee.findUnique.mockResolvedValue({status:'ACTIVE',isQcInspector:false,isQmsHead:true});await expect(service.assertHead(user)).resolves.toBeUndefined();});
 it('gives Super Admin operational access but not implicit QMS approval',async()=>{prisma.employee.findUnique.mockResolvedValue({status:'ACTIVE',isQcInspector:false,isQmsHead:false});const admin={...user,role:Role.SUPER_ADMIN};await expect(service.assertUser(admin)).resolves.toBeUndefined();await expect(service.assertHead(admin)).rejects.toBeInstanceOf(ForbiddenException);});
 it('rejects stale capabilities on an inactive employee',async()=>{prisma.employee.findUnique.mockResolvedValue({status:'INACTIVE',isQcInspector:true,isQmsHead:true});await expect(service.assertUser(user)).rejects.toBeInstanceOf(ForbiddenException);});
});
