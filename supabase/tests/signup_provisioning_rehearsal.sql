-- Atomic live contract rehearsal. No account or profile survives ROLLBACK.
begin;
do $$
declare u uuid:=gen_random_uuid(); t uuid;
begin
 insert into auth.users(id,email,raw_user_meta_data)
 values(u,'provisioning.rehearsal@example.invalid','{"full_name":"Provisioning rehearsal","grade":"B7","role":"admin","tenant_id":"0ee96552-e48d-41da-87dc-7908062ebd95"}');
 if (select role::text from public.profiles where id=u)<>'student' then raise exception 'ROLE_ESCALATION'; end if;
 if (select count(*) from public.student_profiles where user_id=u)<>1 then raise exception 'PROFILE_LINKAGE'; end if;
 perform quizbox_private.provision_student(u,'B9');
 perform quizbox_private.provision_student(u,'B7');
 if (select count(*) from public.student_profiles where user_id=u)<>1 then raise exception 'DUPLICATE_PROFILE'; end if;
 if (select grade::text from public.student_profiles where user_id=u)<>'B7' then raise exception 'GRADE_CHANGED_ON_RETRY'; end if;
 t:=public.qb_public_tenant_id();
 if exists(select 1 from public.tenant_memberships where user_id=u and (tenant_id<>t or role<>'MEMBER')) then raise exception 'TENANT_ESCALATION'; end if;
end $$;
rollback;
select true as signup_role_linkage_retry_rehearsal_passed;
