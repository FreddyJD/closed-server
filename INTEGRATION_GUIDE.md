# 🔄 Battle Cards Integration Guide

## How Lemon Squeezy, WorkOS & Our App Work Together

### 🎯 **The Complete User Journey**

## 🏠 **Individual Users (Simple Path)**

### 1. **Sign Up & Trial**
```
User visits homepage → Click "Start Free Trial" → WorkOS login → 7-day trial starts automatically
```

**What happens:**
- ✅ WorkOS handles authentication (email/password or social login)
- ✅ User account created in our database
- ✅ 7-day trial activated automatically
- ✅ One free license key generated
- ✅ User can download desktop app and start using immediately

### 2. **Trial to Paid Conversion**
```
Trial expires → User clicks "Subscribe" → Lemon Squeezy checkout → Payment success → License activated
```

**What happens:**
- ✅ Lemon Squeezy creates subscription with free trial
- ✅ Webhook activates subscription in our database
- ✅ License keys remain active
- ✅ Billing handled entirely by Lemon Squeezy

---

## 🏢 **Enterprise Users (Advanced Path)**

### 1. **Enterprise Onboarding**
```
Admin visits /enterprise → Fills form → We create Organization → SSO setup → Team invites
```

**What happens:**
- ✅ We create an "Organization" in our database
- ✅ Admin becomes "owner" of the organization
- ✅ WorkOS creates enterprise connection for SSO
- ✅ Company domain linked to organization

### 2. **SSO Configuration**
```
Admin configures SAML/OIDC → WorkOS handles connection → Team members sign in with corporate credentials
```

**What happens:**
- ✅ WorkOS handles all SSO complexity
- ✅ Users authenticate with their corporate identity
- ✅ Automatic assignment to organization
- ✅ Role-based access control

### 3. **Seat Management**
```
Admin adds team members → License keys generated → Billing updates automatically
```

---

## 🔧 **Service Integration Details**

### **Lemon Squeezy Responsibilities**
- 💳 **Payment Processing**: Credit cards, PayPal, etc.
- 🔄 **Subscription Management**: Billing cycles, renewals, cancellations
- 📊 **Revenue Analytics**: MRR, churn, revenue tracking
- 🆓 **Free Trials**: Automatic trial management (7 days)
- 🧾 **Invoicing**: Automatic invoice generation and delivery
- 🌍 **Tax Handling**: Global tax compliance
- 📧 **Email Notifications**: Payment confirmations, receipts

### **WorkOS Responsibilities**
- 🔐 **Authentication**: Login/logout, session management
- 🏢 **Enterprise SSO**: SAML, OIDC integration
- 👥 **User Management**: Profile data, organization membership
- 🔒 **Security**: MFA, password policies, audit logs
- 🎛️ **Admin Portal**: Self-service SSO configuration

### **Our App Responsibilities**
- 🗄️ **Data Management**: Users, subscriptions, licenses, organizations
- 🔑 **License Generation**: Unique keys for desktop app
- 💻 **Desktop API**: License validation, AI card generation
- 🎯 **Business Logic**: Seat limits, feature access, trial management
- 📱 **User Interface**: Dashboard, settings, team management

---

## 📊 **Database Architecture**

### **Individual Users**
```
users (WorkOS data) → subscriptions (Lemon Squeezy) → seats (license keys)
```

### **Enterprise Users**
```
organizations → user_organizations (roles) → subscriptions → seats
                     ↓
                   users (WorkOS SSO)
```

---

## 🔄 **Webhook Event Flow**

### **Lemon Squeezy → Our App**
```
Payment successful → subscription_created webhook → Activate licenses
Trial expires → subscription_updated webhook → Check payment status
Payment fails → subscription_payment_failed → Mark as past_due
```

### **WorkOS → Our App** (Future)
```
User joins organization → Auto-assign to team
SSO configured → Enable for all team members
```

---

## 🚀 **Implementation Status**

### ✅ **What's Working Now**
- Individual user authentication (WorkOS)
- Payment processing (Lemon Squeezy) 
- License key generation and validation
- Subscription webhooks
- Basic dashboard

### 🔧 **What We Just Added**
- Organization support for enterprises
- User-organization relationships with roles
- Enhanced webhook processing
- Payment success/cancel pages
- Free trial management via Lemon Squeezy

### 📋 **Next Steps**
1. **Enterprise Onboarding**: `/enterprise` signup flow
2. **SSO Configuration**: WorkOS organization setup
3. **Team Management**: Invite/remove team members
4. **Admin Portal**: Organization settings and billing
5. **Usage Analytics**: Track license usage and engagement

---

## 💡 **Why This Architecture Works**

### **🎯 Separation of Concerns**
- **Lemon Squeezy**: Handles all payment complexity
- **WorkOS**: Handles all auth complexity  
- **Our App**: Focuses on core business logic

### **🔒 Security & Compliance**
- PCI compliance handled by Lemon Squeezy
- GDPR/SOC2 compliance handled by WorkOS
- We focus on product features, not infrastructure

### **📈 Scalability**
- Each service scales independently
- No vendor lock-in (can switch payment/auth providers)
- Clear boundaries between systems

### **💰 Cost Efficiency**
- Pay only for what you use
- No need to build payment/auth infrastructure
- Faster time to market

---

## 🎛️ **Admin Quick Actions**

### **Individual User Management**
```bash
# Check user subscription
GET /api/admin/users/{user_id}/subscription

# Generate emergency license
POST /api/admin/users/{user_id}/emergency-license

# Refund subscription
POST /api/admin/subscriptions/{sub_id}/refund
```

### **Enterprise Management**
```bash
# Create enterprise organization
POST /api/admin/organizations

# Setup SSO connection
POST /api/admin/organizations/{org_id}/sso

# Bulk license generation
POST /api/admin/organizations/{org_id}/licenses/bulk
```

This architecture gives you a **production-ready SaaS** that can handle both individual users and enterprise customers seamlessly! 🎉 