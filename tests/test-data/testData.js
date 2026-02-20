let userTokensUAT = {
  cmltoken:
    "eyJPU04iOiJDQVJPTElOQV9BT1RGX1VBVCIsImNvbnRhY3RpZCI6IjE4Njc1NjkiLCJlbWFpbCI6InRlc3RjbWx1YXRAbWFpbGluYXRvci5jb20iLCJhZ2VudGlkIjoiNzkzOTkifQ%3D%3D&searchId=bc88fce2-585b-41c7-8c0a-28059857e163",
  canopy:
    "eyJPU04iOiJDQU5PUFlfQU9URl9VQVQiLCJjb250YWN0aWQiOiI0MDI0NzIxIiwiZW1haWwiOiJ0dW1wYWxhK2NhbkBjb3JlbG9naWMuY29tIiwiYWdlbnRpZCI6IjExMDcwMiJ9&searchId=4f31744f-e423-427b-b155-862e1a98a33a",
  yesmls:
    "eyJPU04iOiJDQU5PUFlfQU9URl9VQVQiLCJjb250YWN0aWQiOiI0MDI0Nzc3IiwiZW1haWwiOiJ0dW1wYWxhK3llc0Bjb3JlbG9naWMuY29tIiwiYWdlbnRpZCI6IjgyOTk5In0%3D&searchId=aa958abd-e2b6-3d65-aedd-05746fb8e513",
  unregistered:
    "eyJPU04iOiJZRVNNTFNfQU9URl9VQVQiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTY3Mzk4NSwic2V0aWQiOiI5MjU4MjU2OCIsInNldGtleSI6IjkzMyIsImVtYWlsIjoidW5yZWdpc3RlcmVkb25laG9tZUBtYWlsaW5hdG9yLmNvbSIsInJlc291cmNlaWQiOjAsImFnZW50aWQiOjM2NTUyMywiVmlld01vZGUiOiIxIn0%3D&searchId=c901707a-d30a-3369-8b7d-e7872ed4d8a4",
  //registered: 'eyJPU04iOiJZRVNNTFNfQU9URl9VQVQiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTY3Mzk0MSwic2V0aWQiOiI5MjU2NTg2NyIsInNldGtleSI6IjU5MyIsImVtYWlsIjoicmVnaXN0ZXJlZG9uZWhvbWVAbWFpbGluYXRvci5jb20iLCJyZXNvdXJjZWlkIjowLCJhZ2VudGlkIjozNjU1MjMsIlZpZXdNb2RlIjoiMSJ9&searchId=180dc550-0697-3eea-a542-9699adc2331d',
  registered:
    "eyJPU04iOiJZRVNNTFNfQU9URl9VQVQiLCJjb250YWN0aWQiOiIxNjc1MTc1IiwiZW1haWwiOiJvbmVob21lY2wreWVzQGdtYWlsLmNvbSIsImFnZW50aWQiOiIzNjU1MjkifQ%3D%3D&searchId=563a6bdd-864e-4c0d-8e38-5b799a85bd76",
  registeredNew:
    "eyJPU04iOiJZRVNNTFNfQU9URl9VQVQiLCJjb250YWN0aWQiOiIxNjc1MTc1IiwiZW1haWwiOiJvbmVob21lY2wreWVzQGdtYWlsLmNvbSIsImFnZW50aWQiOiIzNjU1MjkifQ%3D%3D&searchId=563a6bdd-864e-4c0d-8e38-5b799a85bd76",
  registeredTestAgent:
    "eyJPU04iOiJJVFNPX0FPVEZfVUFUIiwiY29udGFjdGlkIjoiNTI5OTAzMiIsImVtYWlsIjoic2FpcmFtOTlAbWFpbGluYXRvci5jb20iLCJhZ2VudGlkIjoiMTAzMzY5In0%3D&searchId=4b7981ef-7dbc-3d68-93af-b5a438cf30f9",
  agentForRegistered:
    "eyJPU04iOiJDQU5PUFlfQU9URl9VQVQiLCJ0eXBlIjoiMSIsInNldGlkIjoiMjMyNDMyNSIsInNldGtleSI6IjQ1MyIsImVtYWlsIjoidHVtcGFsYStjYW5AY29yZWxvZ2ljLmNvbSIsInJlc291cmNlaWQiOjAsImFnZW50aWQiOjExMDcwMiwiaXNkZWx0YSI6ZmFsc2UsIlZpZXdNb2RlIjoiMiIsInNvdXJjZSI6Ik1hdHJpeFVJIn0%3D&SMS=0",
  agentForRegisteredYESMLS:
    "eyJPU04iOiJZRVNNTFNfQU9URl9VQVQiLCJ0eXBlIjoiMSIsInNldGlkIjoiOTYzMTY3Iiwic2V0a2V5IjoiMjYzIiwiZW1haWwiOiJ0dW1wYWxhK3llc0Bjb3JlbG9naWMuY29tIiwicmVzb3VyY2VpZCI6MCwiYWdlbnRpZCI6MzY2NTgwLCJpc2RlbHRhIjpmYWxzZSwiVmlld01vZGUiOiIyIiwic291cmNlIjoiTWF0cml4VUkifQ%3D%3D&SMS=0",
  agentInfo:
    "eyJPU04iOiJZRVNNTFNfQU9URl9VQVQiLCJjb250YWN0aWQiOiIxNjc1MTIyIiwiZW1haWwiOiJ0ZXN0X2FnZW50QG1haWxpbmF0b3IuY29tIiwiYWdlbnRpZCI6IjM2NTUyOSJ9&searchId=150c2b49-1cd4-4e98-b88f-678c1d984764",
  chromeUser1:
    "eyJPU04iOiJJVFNPX0FPVEZfVUFUIiwiY29udGFjdGlkIjoiNTI5OTAzMiIsImVtYWlsIjoic2FpcmFtOTlAbWFpbGluYXRvci5jb20iLCJhZ2VudGlkIjoiMTAzMzY5In0%3D&searchId=4b7981ef-7dbc-3d68-93af-b5a438cf30f9",
  chromeUser2:
    "eyJPU04iOiJZRVNNTFNfQU9URl9VQVQiLCJjb250YWN0aWQiOiIxNjczOTQyIiwiZW1haWwiOiJjaHJvbWVzZWNvbmRjbEBtYWlsaW5hdG9yLmNvbSIsImFnZW50aWQiOiIzNjU1MjMifQ%3D%3D&searchId=c1c29209-d56e-305a-aea6-ff5a614cc9d7",
  chromeUser3:
    "eyJPU04iOiJZRVNNTFNfQU9URl9VQVQiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTY3Mzk4Niwic2V0aWQiOiI5MjU4MjU3NCIsInNldGtleSI6IjQ3NiIsImVtYWlsIjoiY2hyb21ldGhpcmRjbEBtYWlsaW5hdG9yLmNvbSIsInJlc291cmNlaWQiOjAsImFnZW50aWQiOjM2NTUyMywiVmlld01vZGUiOiIxIn0%3D&searchId=44fa6ad0-3cce-3d62-aaf8-a200b56f651f",
  firefoxUser1:
    "eyJPU04iOiJZRVNNTFNfQU9URl9VQVQiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTY3MzkwNiwic2V0aWQiOiI5MjUzMzQ4NSIsInNldGtleSI6IjI0NCIsImVtYWlsIjoiZm94Zmlyc3RAbWFpbGluYXRvci5jb20iLCJyZXNvdXJjZWlkIjowLCJhZ2VudGlkIjozNjU1MjMsIlZpZXdNb2RlIjoiMSJ9&searchId=ca83f973-f880-3d9b-90de-f39521362ac1",
  firefoxUser2:
    "eyJPU04iOiJZRVNNTFNfQU9URl9VQVQiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTY3MzkwNiwic2V0aWQiOiI5MjUzMzQ4NSIsInNldGtleSI6IjI0NCIsImVtYWlsIjoiZm94c2Vjb25kQG1haWxpbmF0b3IuY29tIiwicmVzb3VyY2VpZCI6MCwiYWdlbnRpZCI6MzY1NTIzLCJWaWV3TW9kZSI6IjEifQ==",
  firefoxUser3:
    "eyJPU04iOiJZRVNNTFNfQU9URl9VQVQiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTY3Mzk4Nywic2V0aWQiOiI5MjU4MjU3NSIsInNldGtleSI6IjQyOSIsImVtYWlsIjoiZm94dGhpcmRjbEBtYWlsaW5hdG9yLmNvbSIsInJlc291cmNlaWQiOjAsImFnZW50aWQiOjM2NTUyMywiVmlld01vZGUiOiIxIn0%3D&searchId=f242dda5-18ba-3ba3-b0b7-d6be1d0e9877",
  safariUser1:
    "eyJPU04iOiJZRVNNTFNfQU9URl9VQVQiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTY3NDA0MCwic2V0aWQiOiI5MjYzMTIzNyIsInNldGtleSI6IjEzNSIsImVtYWlsIjoic2FmYXJpZmlyc3RAbWFpbGluYXRvci5jb20iLCJyZXNvdXJjZWlkIjowLCJhZ2VudGlkIjozNjU1MjMsIlZpZXdNb2RlIjoiMSJ9&SMS=0",
  safariUser2:
    "eyJPU04iOiJZRVNNTFNfQU9URl9VQVQiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTY3NDA0Miwic2V0aWQiOiI5MjYzMTI2OSIsInNldGtleSI6IjQ0OSIsImVtYWlsIjoic2FmYXJpc2Vjb25kQG1haWxpbmF0b3IuY29tIiwicmVzb3VyY2VpZCI6MCwiYWdlbnRpZCI6MzY1NTIzLCJWaWV3TW9kZSI6IjEifQ==&SMS=0",
  safariUser3:
    "eyJPU04iOiJZRVNNTFNfQU9URl9VQVQiLCJjb250YWN0aWQiOiIxNjczOTg4IiwiZW1haWwiOiJzYWZhcml0aGlyZEBtYWlsaW5hdG9yLmNvbSIsImFnZW50aWQiOiIzNjU1MjMifQ%3D%3D&searchId=9d60aadd-539c-3cdc-8415-5b12bea9e350",
  edgeUser1:
    "eyJPU04iOiJZRVNNTFNfQU9URl9VQVQiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTY3MzkxMCwic2V0aWQiOiI5MjUzMzQ4NyIsInNldGtleSI6IjI3OSIsImVtYWlsIjoiZWRnZWZpcnN0QG1haWxpbmF0b3IuY29tIiwicmVzb3VyY2VpZCI6MCwiYWdlbnRpZCI6MzY1NTIzLCJWaWV3TW9kZSI6IjEifQ==",
  edgeUser2:
    "eyJPU04iOiJZRVNNTFNfQU9URl9VQVQiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTY3MzkxMCwic2V0aWQiOiI5MjUzMzQ4NyIsInNldGtleSI6IjI3OSIsImVtYWlsIjoiZWRnZXNlY29uZEBtYWlsaW5hdG9yLmNvbSIsInJlc291cmNlaWQiOjAsImFnZW50aWQiOjM2NTUyMywiVmlld01vZGUiOiIxIn0=",
  edgeUser3:
    "eyJPU04iOiJZRVNNTFNfQU9URl9VQVQiLCJjb250YWN0aWQiOiIxNjczOTg5IiwiZW1haWwiOiJlZGdldGhpcmRAbWFpbGluYXRvci5jb20iLCJhZ2VudGlkIjoiMzY1NTIzIn0%3D&searchId=28ce1258-9eb3-3145-b6ac-790f912909b9",
  chrome1Notes:
    "eyJPU04iOiJZRVNNTFNfQU9URl9VQVQiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTY3Mzk1Nywic2V0aWQiOiI5MjU2NjM4OSIsInNldGtleSI6IjAiLCJlbWFpbCI6Im5vdGVzY2hyb21lZmlyc3RjbEBtYWlsaW5hdG9yLmNvbSIsInJlc291cmNlaWQiOjAsImFnZW50aWQiOjM2NTUyMywiVmlld01vZGUiOiIxIn0%3D&searchId=0c1424f3-4774-342a-9f0a-39eab6959f54",
  chrome2Notes:
    "eyJPU04iOiJZRVNNTFNfQU9URl9VQVQiLCJjb250YWN0aWQiOiIxNjczOTU3IiwiZW1haWwiOiJub3Rlc2Nocm9tZXNlY29uZGNsQG1haWxpbmF0b3IuY29tIiwiYWdlbnRpZCI6IjM2NTUyMyJ9&searchId=0c1424f3-4774-342a-9f0a-39eab6959f54",
  firefox1Notes:
    "eyJPU04iOiJZRVNNTFNfQU9URl9VQVQiLCJjb250YWN0aWQiOiIxNjczOTU4IiwiZW1haWwiOiJmb3hmaXJzdG5vdGVzY2xAbWFpbGluYXRvci5jb20iLCJhZ2VudGlkIjoiMzY1NTIzIn0%3D&searchId=7eb6280b-42ba-39e1-9fb5-83b7c61ac878",
  firefox2Notes:
    "eyJPU04iOiJZRVNNTFNfQU9URl9VQVQiLCJjb250YWN0aWQiOiIxNjczOTU4IiwiZW1haWwiOiJmb3hzZWNvbmRub3Rlc2NsQG1haWxpbmF0b3IuY29tIiwiYWdlbnRpZCI6IjM2NTUyMyJ9&searchId=7eb6280b-42ba-39e1-9fb5-83b7c61ac878",
  safari1Notes:
    "eyJPU04iOiJZRVNNTFNfQU9URl9VQVQiLCJjb250YWN0aWQiOiIxNjczOTU5IiwiZW1haWwiOiJzYWZhcmlmaXJzdG5vdGVzY2xAbWFpbGluYXRvci5jb20iLCJhZ2VudGlkIjoiMzY1NTIzIn0%3D&searchId=1f2191ac-0e42-32f7-9776-5b4d0259c141",
  safari2Notes:
    "eyJPU04iOiJZRVNNTFNfQU9URl9VQVQiLCJjb250YWN0aWQiOiIxNjczOTU5IiwiZW1haWwiOiJzYWZhcmlzZWNvbmRub3Rlc2NsQG1haWxpbmF0b3IuY29tIiwiYWdlbnRpZCI6IjM2NTUyMyJ9&searchId=1f2191ac-0e42-32f7-9776-5b4d0259c141",
  edge1Notes:
    "eyJPU04iOiJZRVNNTFNfQU9URl9VQVQiLCJjb250YWN0aWQiOiIxNjczOTYwIiwiZW1haWwiOiJlZGdlZmlyc3Rub3Rlc2NsQG1haWxpbmF0b3IuY29tIiwiYWdlbnRpZCI6IjM2NTUyMyJ9&searchId=7fcd2ef0-e987-35f2-8a58-d80850863b9f",
  edge2Notes:
    "eyJPU04iOiJZRVNNTFNfQU9URl9VQVQiLCJjb250YWN0aWQiOiIxNjczOTYwIiwiZW1haWwiOiJlZGdlc2Vjb25kbm90ZXNjbEBtYWlsaW5hdG9yLmNvbSIsImFnZW50aWQiOiIzNjU1MjMifQ%3D%3D&searchId=7fcd2ef0-e987-35f2-8a58-d80850863b9f",
  editProfile:
    "eyJPU04iOiJZRVNNTFNfQU9URl9VQVQiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTY3NDAxMiwic2V0aWQiOiI5MjYxNTA4MyIsInNldGtleSI6IjEiLCJlbWFpbCI6ImVkaXR0ZXN0Y2xAbWFpbGluYXRvci5jb20iLCJyZXNvdXJjZWlkIjowLCJhZ2VudGlkIjozNjU1MjMsIlZpZXdNb2RlIjoiMSJ9&SMS=0",
  clusterPins:
    "eyJPU04iOiJDQVJPTElOQV9BT1RGX1VBVCIsImNvbnRhY3RpZCI6IjE4Njk2NDEiLCJlbWFpbCI6InRlc3RlcjFAbWFpbGluYXRvci5jb20iLCJhZ2VudGlkIjoiNzk0MjMifQ%3D%3D&searchId=72b98eaa-3e71-3360-9aa6-249b5a1965d8",
  itso:
    "eyJPU04iOiJJVFNPX0FPVEZfVUFUIiwiY29udGFjdGlkIjoiNTMwMjE2NCIsImVtYWlsIjoidHVtcGFsYStpdHNvQGNvcmVsb2dpYy5jb20iLCJhZ2VudGlkIjoiMTAzNDA1In0%3D&searchId=44fb19b8-81fd-321b-a29b-b896642969cb",
};

let userTokensPROD = {
  unregistered:
    "eyJPU04iOiJGQVkiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTUzODY3LCJzZXRpZCI6IjM0MzMwNTciLCJzZXRrZXkiOiI0NDYiLCJlbWFpbCI6InVucmVnaXN0ZXJlZG9uZWhvbWVAbWFpbGluYXRvci5jb20iLCJyZXNvdXJjZWlkIjowLCJhZ2VudGlkIjo3MzM2LCJWaWV3TW9kZSI6IjEifQ==&SMS=0",
  registered:
    "eyJPU04iOiJGQVkiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTUzODUxLCJzZXRpZCI6IjM0MzMwNzMiLCJzZXRrZXkiOiI0ODAiLCJlbWFpbCI6InJlZ2lzdGVyZWRvbmVob21lQG1haWxpbmF0b3IuY29tIiwicmVzb3VyY2VpZCI6MCwiYWdlbnRpZCI6NzMzNiwiVmlld01vZGUiOiIxIn0=&SMS=0",
  agentForRegistered:
    "eyJPU04iOiJGQVkiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTUzODUxLCJzZXRpZCI6IjM0MzMwNzMiLCJzZXRrZXkiOiI0ODAiLCJlbWFpbCI6InJlZ2lzdGVyZWRvbmVob21lQG1haWxpbmF0b3IuY29tIiwicmVzb3VyY2VpZCI6MCwiYWdlbnRpZCI6NzMzNiwiVmlld01vZGUiOiIyIn0%3D&SMS=0&searchId=db2b0b8b-b2c8-3021-8bca-9bbbca78fe4e",
  chromeUser1:
    "eyJPU04iOiJGQVkiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTUzODU0LCJzZXRpZCI6IjM0MzM1MDciLCJzZXRrZXkiOiIxNjEiLCJlbWFpbCI6ImNocm9tZWZpcnN0Y2xAbWFpbGluYXRvci5jb20iLCJyZXNvdXJjZWlkIjowLCJhZ2VudGlkIjo3MzM2LCJWaWV3TW9kZSI6IjEifQ==&SMS=0",
  chromeUser2:
    "eyJPU04iOiJGQVkiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTUzODU0LCJzZXRpZCI6IjM0MzM1MDciLCJzZXRrZXkiOiIxNjEiLCJlbWFpbCI6ImNocm9tZXNlY29uZGNsQG1haWxpbmF0b3IuY29tIiwicmVzb3VyY2VpZCI6MCwiYWdlbnRpZCI6NzMzNiwiVmlld01vZGUiOiIxIn0=&SMS=0",
  chromeUser3:
    "eyJPU04iOiJGQVkiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTUzODU3LCJzZXRpZCI6IjM0MzM1MjIiLCJzZXRrZXkiOiIzOTciLCJlbWFpbCI6ImNocm9tZXRoaXJkY2xAbWFpbGluYXRvci5jb20iLCJyZXNvdXJjZWlkIjowLCJhZ2VudGlkIjo3MzM2LCJWaWV3TW9kZSI6IjEifQ==&SMS=0",
  firefoxUser1:
    "eyJPU04iOiJGQVkiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTUzODYyLCJzZXRpZCI6IjM0MzM2ODEiLCJzZXRrZXkiOiIyNjIiLCJlbWFpbCI6ImZveGZpcnN0QG1haWxpbmF0b3IuY29tIiwicmVzb3VyY2VpZCI6MCwiYWdlbnRpZCI6NzMzNiwiVmlld01vZGUiOiIxIn0=&SMS=0",
  firefoxUser2:
    "eyJPU04iOiJGQVkiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTUzODYyLCJzZXRpZCI6IjM0MzM2ODEiLCJzZXRrZXkiOiIyNjIiLCJlbWFpbCI6ImZveHNlY29uZEBtYWlsaW5hdG9yLmNvbSIsInJlc291cmNlaWQiOjAsImFnZW50aWQiOjczMzYsIlZpZXdNb2RlIjoiMSJ9&SMS=0",
  firefoxUser3:
    "eyJPU04iOiJGQVkiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTUzODU5LCJzZXRpZCI6IjM0MzM2OTQiLCJzZXRrZXkiOiI0NjAiLCJlbWFpbCI6ImZveHRoaXJkY2xAbWFpbGluYXRvci5jb20iLCJyZXNvdXJjZWlkIjowLCJhZ2VudGlkIjo3MzM2LCJWaWV3TW9kZSI6IjEifQ==&SMS=0",
  safariUser1:
    "eyJPU04iOiJGQVkiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTUzODY0LCJzZXRpZCI6IjM0MzM1MjMiLCJzZXRrZXkiOiI0NzYiLCJlbWFpbCI6InNhZmFyaWZpcnN0QG1haWxpbmF0b3IuY29tIiwicmVzb3VyY2VpZCI6MCwiYWdlbnRpZCI6NzMzNiwiVmlld01vZGUiOiIxIn0=&SMS=0",
  safariUser2:
    "eyJPU04iOiJGQVkiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTUzODY0LCJzZXRpZCI6IjM0MzM1MjMiLCJzZXRrZXkiOiI0NzYiLCJlbWFpbCI6InNhZmFyaXNlY29uZEBtYWlsaW5hdG9yLmNvbSIsInJlc291cmNlaWQiOjAsImFnZW50aWQiOjczMzYsIlZpZXdNb2RlIjoiMSJ9&SMS=0",
  safariUser3:
    "eyJPU04iOiJGQVkiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTUzODY2LCJzZXRpZCI6IjM0MzM2NzgiLCJzZXRrZXkiOiIzNTkiLCJlbWFpbCI6InNhZmFyaXRoaXJkQG1haWxpbmF0b3IuY29tIiwicmVzb3VyY2VpZCI6MCwiYWdlbnRpZCI6NzMzNiwiVmlld01vZGUiOiIxIn0=&SMS=0",
  edgeUser1:
    "eyJPU04iOiJGQVkiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTUzODYwLCJzZXRpZCI6IjM0MzM2OTgiLCJzZXRrZXkiOiI5MzciLCJlbWFpbCI6ImVkZ2VmaXJzdEBtYWlsaW5hdG9yLmNvbSIsInJlc291cmNlaWQiOjAsImFnZW50aWQiOjczMzYsIlZpZXdNb2RlIjoiMSJ9&SMS=0",
  edgeUser2:
    "eyJPU04iOiJGQVkiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTUzODYwLCJzZXRpZCI6IjM0MzM2OTgiLCJzZXRrZXkiOiI5MzciLCJlbWFpbCI6ImVkZ2VzZWNvbmRAbWFpbGluYXRvci5jb20iLCJyZXNvdXJjZWlkIjowLCJhZ2VudGlkIjo3MzM2LCJWaWV3TW9kZSI6IjEifQ==&SMS=0",
  edgeUser3:
    "eyJPU04iOiJGQVkiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTUzODU4LCJzZXRpZCI6IjM0MzM3MDIiLCJzZXRrZXkiOiI2NjEiLCJlbWFpbCI6ImVkZ2V0aGlyZEBtYWlsaW5hdG9yLmNvbSIsInJlc291cmNlaWQiOjAsImFnZW50aWQiOjczMzYsIlZpZXdNb2RlIjoiMSJ9&SMS=0",
  chrome1Notes:
    "eyJPU04iOiJGQVkiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTUzODY4LCJzZXRpZCI6IjM0MzMwOTEiLCJzZXRrZXkiOiIxNjQiLCJlbWFpbCI6Im5vdGVzY2hyb21lZmlyc3RjbEBtYWlsaW5hdG9yLmNvbSIsInJlc291cmNlaWQiOjAsImFnZW50aWQiOjczMzYsIlZpZXdNb2RlIjoiMSJ9&SMS=0",
  chrome2Notes:
    "eyJPU04iOiJGQVkiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTUzODY4LCJzZXRpZCI6IjM0MzMwOTEiLCJzZXRrZXkiOiIxNjQiLCJlbWFpbCI6Im5vdGVzY2hyb21lc2Vjb25kY2xAbWFpbGluYXRvci5jb20iLCJyZXNvdXJjZWlkIjowLCJhZ2VudGlkIjo3MzM2LCJWaWV3TW9kZSI6IjEifQ==&SMS=0",
  firefox1Notes:
    "eyJPU04iOiJGQVkiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTUzODcwLCJzZXRpZCI6IjM0MzM1MDIiLCJzZXRrZXkiOiIyMSIsImVtYWlsIjoiZm94Zmlyc3Rub3Rlc2NsQG1haWxpbmF0b3IuY29tIiwicmVzb3VyY2VpZCI6MCwiYWdlbnRpZCI6NzMzNiwiVmlld01vZGUiOiIxIn0=&SMS=0",
  firefox2Notes:
    "eyJPU04iOiJGQVkiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTUzODcwLCJzZXRpZCI6IjM0MzM1MDIiLCJzZXRrZXkiOiIyMSIsImVtYWlsIjoiZm94c2Vjb25kbm90ZXNjbEBtYWlsaW5hdG9yLmNvbSIsInJlc291cmNlaWQiOjAsImFnZW50aWQiOjczMzYsIlZpZXdNb2RlIjoiMSJ9&SMS=0",
  safari1Notes:
    "eyJPU04iOiJGQVkiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTUzODcxLCJzZXRpZCI6IjM0MzM0OTQiLCJzZXRrZXkiOiI1NjQiLCJlbWFpbCI6InNhZmFyaWZpcnN0bm90ZXNjbEBtYWlsaW5hdG9yLmNvbSIsInJlc291cmNlaWQiOjAsImFnZW50aWQiOjczMzYsIlZpZXdNb2RlIjoiMSJ9&SMS=0",
  safari2Notes:
    "eyJPU04iOiJGQVkiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTUzODcxLCJzZXRpZCI6IjM0MzM0OTQiLCJzZXRrZXkiOiI1NjQiLCJlbWFpbCI6InNhZmFyaXNlY29uZG5vdGVzY2xAbWFpbGluYXRvci5jb20iLCJyZXNvdXJjZWlkIjowLCJhZ2VudGlkIjo3MzM2LCJWaWV3TW9kZSI6IjEifQ==&SMS=0",
  edge1Notes:
    "eyJPU04iOiJGQVkiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTUzODY5LCJzZXRpZCI6IjM0MzM1MDYiLCJzZXRrZXkiOiI5MzgiLCJlbWFpbCI6ImVkZ2VmaXJzdG5vdGVzY2xAbWFpbGluYXRvci5jb20iLCJyZXNvdXJjZWlkIjowLCJhZ2VudGlkIjo3MzM2LCJWaWV3TW9kZSI6IjEifQ==&SMS=0",
  edge2Notes:
    "eyJPU04iOiJGQVkiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTUzODY5LCJzZXRpZCI6IjM0MzM1MDYiLCJzZXRrZXkiOiI5MzgiLCJlbWFpbCI6ImVkZ2VzZWNvbmRub3Rlc2NsQG1haWxpbmF0b3IuY29tIiwicmVzb3VyY2VpZCI6MCwiYWdlbnRpZCI6NzMzNiwiVmlld01vZGUiOiIxIn0=&SMS=0",
  switchAgent:
    "eyJPU04iOiJDQVJPTElOQV9BT1RGX1VBVCIsImNvbnRhY3RpZCI6IjE4Njk2NDEiLCJlbWFpbCI6InRlc3RlcjFAbWFpbGluYXRvci5jb20iLCJhZ2VudGlkIjoiNzk0MjMifQ%3D%3D&searchId=72b98eaa-3e71-3360-9aa6-249b5a1965d8",
  editProfile:
    "eyJPU04iOiJGQVkiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTUzODUzLCJzZXRpZCI6IjM0MzMwODUiLCJzZXRrZXkiOiI3MTgiLCJlbWFpbCI6ImVkaXR0ZXN0Y2xAbWFpbGluYXRvci5jb20iLCJyZXNvdXJjZWlkIjowLCJhZ2VudGlkIjo3MzM2LCJWaWV3TW9kZSI6IjEifQ==&SMS=0",
};

let userTokensDEV = {
  unregistered:
    "eyJPU04iOiJZRVNNTFNfQU9URl9ERVYiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTU4OTgyMCwic2V0aWQiOiI5Njk3ODM4OSIsInNldGtleSI6IjMyNCIsImVtYWlsIjoidW5yZWdpc3RlcmVkb25laG9tZUBtYWlsaW5hdG9yLmNvbSIsInJlc291cmNlaWQiOjAsImFnZW50aWQiOjM2MjQyMywiVmlld01vZGUiOiIxIn0%3D&SMS=0&searchId=5fd2d7e6-3d90-393a-8624-e5940bf1f32d",
  registered:
    "eyJPU04iOiJZRVNNTFNfQU9URl9ERVYiLCJjb250YWN0aWQiOiIxNTg5ODA2IiwiZW1haWwiOiJyZWdpc3RlcmVkb25laG9tZUBtYWlsaW5hdG9yLmNvbSIsImFnZW50aWQiOiIzNjI0MjMifQ%3D%3D&searchId=83a69e63-5700-319f-bc50-47d2100dc5c5",
  agentForRegistered:
    "eyJPU04iOiJZRVNNTFNfQU9URl9ERVYiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTU4OTgyOSwic2V0aWQiOiI5Njk3ODUzMSIsInNldGtleSI6IjkyMSIsImVtYWlsIjoidGVzdHVpdGVzdEBtYWlsaW5hdG9yLmNvbSIsInJlc291cmNlaWQiOjAsImFnZW50aWQiOjM2MjQyMywiVmlld01vZGUiOiIyIn0=&SMS=0",
  chromeUser1:
    "eyJPU04iOiJZRVNNTFNfQU9URl9ERVYiLCJjb250YWN0aWQiOiIxNTg5ODA3IiwiZW1haWwiOiJjaHJvbWVmaXJzdGNsQG1haWxpbmF0b3IuY29tIiwiYWdlbnRpZCI6IjM2MjQyMyJ9&searchId=699579bf-1279-3e8b-8fb9-8cc91b032692",
  chromeUser2:
    "eyJPU04iOiJZRVNNTFNfQU9URl9ERVYiLCJjb250YWN0aWQiOiIxNTg5ODA3IiwiZW1haWwiOiJjaHJvbWVzZWNvbmRjbEBtYWlsaW5hdG9yLmNvbSIsImFnZW50aWQiOiIzNjI0MjMifQ%3D%3D&searchId=699579bf-1279-3e8b-8fb9-8cc91b032692",
  chromeUser3:
    "eyJPU04iOiJZRVNNTFNfQU9URl9ERVYiLCJjb250YWN0aWQiOiIxNTg5ODEwIiwiZW1haWwiOiJjaHJvbWV0aGlyZGNsQG1haWxpbmF0b3IuY29tIiwiYWdlbnRpZCI6IjM2MjQyMyJ9&searchId=880a73a7-ed7b-36d5-be69-9c4dc22605b0",
  firefoxUser1:
    "eyJPU04iOiJZRVNNTFNfQU9URl9ERVYiLCJjb250YWN0aWQiOiIxNTg5ODE1IiwiZW1haWwiOiJmb3hmaXJzdEBtYWlsaW5hdG9yLmNvbSIsImFnZW50aWQiOiIzNjI0MjMifQ%3D%3D&searchId=0d1e3d54-8dd2-390c-96af-865c387aa6a5",
  firefoxUser2:
    "eyJPU04iOiJZRVNNTFNfQU9URl9ERVYiLCJjb250YWN0aWQiOiIxNTg5ODE1IiwiZW1haWwiOiJmb3hzZWNvbmRAbWFpbGluYXRvci5jb20iLCJhZ2VudGlkIjoiMzYyNDIzIn0%3D&searchId=0d1e3d54-8dd2-390c-96af-865c387aa6a5",
  firefoxUser3:
    "eyJPU04iOiJZRVNNTFNfQU9URl9ERVYiLCJjb250YWN0aWQiOiIxNTg5ODEyIiwiZW1haWwiOiJmb3h0aGlyZGNsQG1haWxpbmF0b3IuY29tIiwiYWdlbnRpZCI6IjM2MjQyMyJ9&searchId=f533bea7-5571-3fb5-b3c5-3155b7666e07",
  safariUser1:
    "eyJPU04iOiJZRVNNTFNfQU9URl9ERVYiLCJjb250YWN0aWQiOiIxNTg5ODE3IiwiZW1haWwiOiJzYWZhcmlmaXJzdEBtYWlsaW5hdG9yLmNvbSIsImFnZW50aWQiOiIzNjI0MjMifQ%3D%3D&searchId=90ab9e42-7d78-3d14-90d8-ce44ee2467e5",
  safariUser2:
    "eyJPU04iOiJZRVNNTFNfQU9URl9ERVYiLCJjb250YWN0aWQiOiIxNTg5ODE3IiwiZW1haWwiOiJzYWZhcmlzZWNvbmRAbWFpbGluYXRvci5jb20iLCJhZ2VudGlkIjoiMzYyNDIzIn0%3D&searchId=90ab9e42-7d78-3d14-90d8-ce44ee2467e5",
  safariUser3:
    "eyJPU04iOiJZRVNNTFNfQU9URl9ERVYiLCJjb250YWN0aWQiOiIxNTg5ODE5IiwiZW1haWwiOiJzYWZhcml0aGlyZEBtYWlsaW5hdG9yLmNvbSIsImFnZW50aWQiOiIzNjI0MjMifQ%3D%3D&searchId=db1bda58-04b9-3ed4-adad-7b338a2ddd8d",
  edgeUser1:
    "eyJPU04iOiJZRVNNTFNfQU9URl9ERVYiLCJjb250YWN0aWQiOiIxNTg5ODEzIiwiZW1haWwiOiJlZGdlZmlyc3RAbWFpbGluYXRvci5jb20iLCJhZ2VudGlkIjoiMzYyNDIzIn0%3D&searchId=0f649ab8-3ec3-337a-b63f-0fb60c4ffb57",
  edgeUser2:
    "eyJPU04iOiJZRVNNTFNfQU9URl9ERVYiLCJjb250YWN0aWQiOiIxNTg5ODEzIiwiZW1haWwiOiJlZGdlc2Vjb25kQG1haWxpbmF0b3IuY29tIiwiYWdlbnRpZCI6IjM2MjQyMyJ9&searchId=0f649ab8-3ec3-337a-b63f-0fb60c4ffb57",
  edgeUser3:
    "eyJPU04iOiJZRVNNTFNfQU9URl9ERVYiLCJjb250YWN0aWQiOiIxNTg5ODExIiwiZW1haWwiOiJlZGdldGhpcmRAbWFpbGluYXRvci5jb20iLCJhZ2VudGlkIjoiMzYyNDIzIn0%3D&searchId=dc54b3cb-92f7-3ce7-a914-6bf4004a926d",
  chrome1Notes:
    "eyJPU04iOiJZRVNNTFNfQU9URl9ERVYiLCJjb250YWN0aWQiOiIxNTg5ODIxIiwiZW1haWwiOiJub3Rlc2Nocm9tZWZpcnN0Y2xAbWFpbGluYXRvci5jb20iLCJhZ2VudGlkIjoiMzYyNDIzIn0%3D&searchId=1b5debe8-0c2e-3aff-9b78-4eb878e6e771",
  chrome2Notes:
    "eyJPU04iOiJZRVNNTFNfQU9URl9ERVYiLCJjb250YWN0aWQiOiIxNTg5ODIxIiwiZW1haWwiOiJub3Rlc2Nocm9tZXNlY29uZGNsQG1haWxpbmF0b3IuY29tIiwiYWdlbnRpZCI6IjM2MjQyMyJ9&searchId=1b5debe8-0c2e-3aff-9b78-4eb878e6e771",
  firefox1Notes:
    "eyJPU04iOiJZRVNNTFNfQU9URl9ERVYiLCJjb250YWN0aWQiOiIxNTg5ODIzIiwiZW1haWwiOiJmb3hmaXJzdG5vdGVzY2xAbWFpbGluYXRvci5jb20iLCJhZ2VudGlkIjoiMzYyNDIzIn0%3D&searchId=de0ef73e-9c26-39c3-93b9-90c6e4ace3e7",
  firefox2Notes:
    "eyJPU04iOiJZRVNNTFNfQU9URl9ERVYiLCJjb250YWN0aWQiOiIxNTg5ODIzIiwiZW1haWwiOiJmb3hzZWNvbmRub3Rlc2NsQG1haWxpbmF0b3IuY29tIiwiYWdlbnRpZCI6IjM2MjQyMyJ9&searchId=de0ef73e-9c26-39c3-93b9-90c6e4ace3e7",
  safari1Notes:
    "eyJPU04iOiJZRVNNTFNfQU9URl9ERVYiLCJjb250YWN0aWQiOiIxNTg5ODI0IiwiZW1haWwiOiJzYWZhcmlmaXJzdG5vdGVzY2xAbWFpbGluYXRvci5jb20iLCJhZ2VudGlkIjoiMzYyNDIzIn0%3D&searchId=706d2964-3aea-31c6-bfc0-0676fd92480e",
  safari2Notes:
    "eyJPU04iOiJZRVNNTFNfQU9URl9ERVYiLCJjb250YWN0aWQiOiIxNTg5ODI0IiwiZW1haWwiOiJzYWZhcmlzZWNvbmRub3Rlc2NsQG1haWxpbmF0b3IuY29tIiwiYWdlbnRpZCI6IjM2MjQyMyJ9&searchId=706d2964-3aea-31c6-bfc0-0676fd92480e",
  edge1Notes:
    "eyJPU04iOiJZRVNNTFNfQU9URl9ERVYiLCJjb250YWN0aWQiOiIxNTg5ODIyIiwiZW1haWwiOiJlZGdlZmlyc3Rub3Rlc2NsQG1haWxpbmF0b3IuY29tIiwiYWdlbnRpZCI6IjM2MjQyMyJ9&searchId=b7a74d62-35da-3fb9-95b2-a44f302f81fd",
  edge2Notes:
    "eyJPU04iOiJZRVNNTFNfQU9URl9ERVYiLCJjb250YWN0aWQiOiIxNTg5ODIyIiwiZW1haWwiOiJlZGdlc2Vjb25kbm90ZXNjbEBtYWlsaW5hdG9yLmNvbSIsImFnZW50aWQiOiIzNjI0MjMifQ%3D%3D&searchId=b7a74d62-35da-3fb9-95b2-a44f302f81fd",
};

let userTokensINT = {
  unregistered:
    "eyJPU04iOiJDQVJPTElOQV9BT1RGX0lOVCIsInR5cGUiOiIwIiwiY29udGFjdGlkIjoxODYzMjQ4LCJzZXRpZCI6IjM2MTAyODgwOCIsInNldGtleSI6IjMzMiIsImVtYWlsIjoiYXV0b21hdGlvbkBtYWlsaW5hdG9yLmNvbSIsInJlc291cmNlaWQiOjAsImFnZW50aWQiOjc3Mzg5LCJWaWV3TW9kZSI6IjEifQ%3D%3D&SMS=0&searchId=7024f9bd-b60b-38df-91aa-97df89b1e52c",
  registered:
    "eyJPU04iOiJZRVNNTFNfQU9URl9JTlQiLCJjb250YWN0aWQiOiIxNTk1MzkyIiwiZW1haWwiOiJvbmVob21lY2wreWVzQGdtYWlsLmNvbSIsImFnZW50aWQiOiIzNjI0NTAifQ%3D%3D&searchId=6616c0de-1f58-3fc0-9e67-2291c3039927",
  registered1:
    "eyJPU04iOiJZRVNNTFNfQU9URl9JTlQiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTU5NTM4OSwic2V0aWQiOiI5MTk4NDUxOSIsInNldGtleSI6IjE0NCIsImVtYWlsIjoidGVzdGNtbHVhdEBtYWlsaW5hdG9yLmNvbSIsInJlc291cmNlaWQiOjEsImFnZW50aWQiOjM2MjQ1MCwiVmlld01vZGUiOiIxIn0%3D&SMS=0&searchId=a1e56af2-73ec-3d7b-bcac-338f409058f6",
  registeredTestAgent:
    "eyJPU04iOiJZRVNNTFNfQU9URl9JTlQiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTU5NTM5Niwic2V0aWQiOiI5MTk4NDUyMCIsInNldGtleSI6IjUxMSIsImVtYWlsIjoidGVzdF9hZ2VudEBtYWlsaW5hdG9yLmNvbSIsInJlc291cmNlaWQiOjAsImFnZW50aWQiOjM2MjQ1MCwiVmlld01vZGUiOiIxIn0%3D&SMS=0&searchId=76f6d947-cfca-3e39-a2f3-67e1b5ace75b",
  agentForRegistered:
    "eyJPU04iOiJZRVNNTFNfQU9URl9JTlQiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTU5MTA5OCwic2V0aWQiOiI5MTk3MDY2MSIsInNldGtleSI6IjM2MiIsImVtYWlsIjoiZWRnZWZpcnN0QG1haWxpbmF0b3IuY29tIiwicmVzb3VyY2VpZCI6MCwiYWdlbnRpZCI6MzYyNDIzLCJWaWV3TW9kZSI6IjIifQ%3D%3D&searchId=96f7945d-6707-338c-b3fd-035a57baafa9",
  chromeUser1:
    "eyJPU04iOiJZRVNNTFNfQU9URl9JTlQiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTU5NjQ2Niwic2V0aWQiOiI5MTk4NzQ1NCIsInNldGtleSI6IjQ3NiIsImVtYWlsIjoiY2hyb21lZmlyc3RjbEBtYWlsaW5hdG9yLmNvbSIsInJlc291cmNlaWQiOjAsImFnZW50aWQiOjM2MjQ1MCwiVmlld01vZGUiOiIxIn0%3D&SMS=0&searchId=73476ead-00ba-392e-b9d6-319f43769443",
  chromeUser2:
    "eyJPU04iOiJZRVNNTFNfQU9URl9JTlQiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTU5NjQ2Nywic2V0aWQiOiI5MTk4NzQ1NiIsInNldGtleSI6IjgwOSIsImVtYWlsIjoiY2hyb21lc2Vjb25kY2xAbWFpbGluYXRvci5jb20iLCJyZXNvdXJjZWlkIjowLCJhZ2VudGlkIjozNjI0NTAsIlZpZXdNb2RlIjoiMSJ9&SMS=0&searchId=20ae3b97-a961-3869-aa04-4ddbb4e2152b",
  chromeUser3:
    "eyJPU04iOiJZRVNNTFNfQU9URl9JTlQiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTU5MTA5NSwic2V0aWQiOiI5MTk3MDY1NiIsInNldGtleSI6IjE5MyIsImVtYWlsIjoiY2hyb21ldGhpcmRjbEBtYWlsaW5hdG9yLmNvbSIsInJlc291cmNlaWQiOjAsImFnZW50aWQiOjM2MjQyMywiVmlld01vZGUiOiIxIn0=",
  firefoxUser1:
    "eyJPU04iOiJZRVNNTFNfQU9URl9JTlQiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTU5MTEwMCwic2V0aWQiOiI5MTk3MDY1NyIsInNldGtleSI6Ijg4MSIsImVtYWlsIjoiZm94Zmlyc3RAbWFpbGluYXRvci5jb20iLCJyZXNvdXJjZWlkIjowLCJhZ2VudGlkIjozNjI0MjMsIlZpZXdNb2RlIjoiMSJ9",
  firefoxUser2:
    "eyJPU04iOiJZRVNNTFNfQU9URl9JTlQiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTU5MTEwMCwic2V0aWQiOiI5MTk3MDY1NyIsInNldGtleSI6Ijg4MSIsImVtYWlsIjoiZm94c2Vjb25kQG1haWxpbmF0b3IuY29tIiwicmVzb3VyY2VpZCI6MCwiYWdlbnRpZCI6MzYyNDIzLCJWaWV3TW9kZSI6IjEifQ==",
  firefoxUser3:
    "eyJPU04iOiJZRVNNTFNfQU9URl9JTlQiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTU5MTA5Nywic2V0aWQiOiI5MTk3MDY1OCIsInNldGtleSI6IjUxNSIsImVtYWlsIjoiZm94dGhpcmRjbEBtYWlsaW5hdG9yLmNvbSIsInJlc291cmNlaWQiOjAsImFnZW50aWQiOjM2MjQyMywiVmlld01vZGUiOiIxIn0=",
  safariUser1:
    "eyJPU04iOiJZRVNNTFNfQU9URl9JTlQiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTU5MTEwMiwic2V0aWQiOiI5MTk3MDY1OSIsInNldGtleSI6IjUzMiIsImVtYWlsIjoic2FmYXJpZmlyc3RAbWFpbGluYXRvci5jb20iLCJyZXNvdXJjZWlkIjowLCJhZ2VudGlkIjozNjI0MjMsIlZpZXdNb2RlIjoiMSJ9",
  safariUser2:
    "eyJPU04iOiJZRVNNTFNfQU9URl9JTlQiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTU5MTEwMiwic2V0aWQiOiI5MTk3MDY1OSIsInNldGtleSI6IjUzMiIsImVtYWlsIjoic2FmYXJpc2Vjb25kQG1haWxpbmF0b3IuY29tIiwicmVzb3VyY2VpZCI6MCwiYWdlbnRpZCI6MzYyNDIzLCJWaWV3TW9kZSI6IjEifQ==",
  safariUser3:
    "eyJPU04iOiJZRVNNTFNfQU9URl9JTlQiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTU5MTEwNCwic2V0aWQiOiI5MTk3MDY2MCIsInNldGtleSI6IjY1NiIsImVtYWlsIjoic2FmYXJpdGhpcmRAbWFpbGluYXRvci5jb20iLCJyZXNvdXJjZWlkIjowLCJhZ2VudGlkIjozNjI0MjMsIlZpZXdNb2RlIjoiMSJ9",
  edgeUser1:
    "eyJPU04iOiJZRVNNTFNfQU9URl9JTlQiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTU5MTA5OCwic2V0aWQiOiI5MTk3MDY2MSIsInNldGtleSI6IjM2MiIsImVtYWlsIjoiZWRnZWZpcnN0QG1haWxpbmF0b3IuY29tIiwicmVzb3VyY2VpZCI6MCwiYWdlbnRpZCI6MzYyNDIzLCJWaWV3TW9kZSI6IjEifQ==",
  edgeUser2:
    "eyJPU04iOiJZRVNNTFNfQU9URl9JTlQiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTU5MTA5OCwic2V0aWQiOiI5MTk3MDY2MSIsInNldGtleSI6IjM2MiIsImVtYWlsIjoiZWRnZXNlY29uZEBtYWlsaW5hdG9yLmNvbSIsInJlc291cmNlaWQiOjAsImFnZW50aWQiOjM2MjQyMywiVmlld01vZGUiOiIxIn0=",
  edgeUser3:
    "eyJPU04iOiJZRVNNTFNfQU9URl9JTlQiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTU5MTA5Niwic2V0aWQiOiI5MTk3MDY2MiIsInNldGtleSI6IjYwNiIsImVtYWlsIjoiZWRnZXRoaXJkQG1haWxpbmF0b3IuY29tIiwicmVzb3VyY2VpZCI6MCwiYWdlbnRpZCI6MzYyNDIzLCJWaWV3TW9kZSI6IjEifQ==",
  chrome1Notes:
    "eyJPU04iOiJZRVNNTFNfQU9URl9JTlQiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTU5NzgwNSwic2V0aWQiOiI5MjAwNTA4NSIsInNldGtleSI6Ijc2MSIsImVtYWlsIjoibm90ZXNjaHJvbWVmaXJzdGNsQG1haWxpbmF0b3IuY29tIiwicmVzb3VyY2VpZCI6MCwiYWdlbnRpZCI6MzYzNDU2LCJWaWV3TW9kZSI6IjEifQ%3D%3D&SMS=0&searchId=d6a47875-ed69-35cf-95c5-9bf5ae1e946c",
  chrome2Notes:
    "eyJPU04iOiJZRVNNTFNfQU9URl9JTlQiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTU5NzgwNSwic2V0aWQiOiI5MjAwNTA4NSIsInNldGtleSI6Ijc2MSIsImVtYWlsIjoibm90ZXNjaHJvbWVzZWNvbmRjbEBtYWlsaW5hdG9yLmNvbSIsInJlc291cmNlaWQiOjAsImFnZW50aWQiOjM2MzQ1NiwiVmlld01vZGUiOiIxIn0%3D&SMS=0&searchId=d6a47875-ed69-35cf-95c5-9bf5ae1e946c",
  firefox1Notes:
    "eyJPU04iOiJZRVNNTFNfQU9URl9JTlQiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTU5MTEwOCwic2V0aWQiOiI5MTk3MDY1MiIsInNldGtleSI6IjUyNiIsImVtYWlsIjoiZm94Zmlyc3Rub3Rlc2NsQG1haWxpbmF0b3IuY29tIiwicmVzb3VyY2VpZCI6MCwiYWdlbnRpZCI6MzYyNDIzLCJWaWV3TW9kZSI6IjEifQ==",
  firefox2Notes:
    "eyJPU04iOiJZRVNNTFNfQU9URl9JTlQiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTU5MTEwOCwic2V0aWQiOiI5MTk3MDY1MiIsInNldGtleSI6IjUyNiIsImVtYWlsIjoiZm94c2Vjb25kbm90ZXNjbEBtYWlsaW5hdG9yLmNvbSIsInJlc291cmNlaWQiOjAsImFnZW50aWQiOjM2MjQyMywiVmlld01vZGUiOiIxIn0=",
  safari1Notes:
    "eyJPU04iOiJZRVNNTFNfQU9URl9JTlQiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTU5MTEwOSwic2V0aWQiOiI5MTk3MDY1MyIsInNldGtleSI6IjQ5NyIsImVtYWlsIjoic2FmYXJpZmlyc3Rub3Rlc2NsQG1haWxpbmF0b3IuY29tIiwicmVzb3VyY2VpZCI6MCwiYWdlbnRpZCI6MzYyNDIzLCJWaWV3TW9kZSI6IjEifQ==",
  safari2Notes:
    "eyJPU04iOiJZRVNNTFNfQU9URl9JTlQiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTU5MTEwOSwic2V0aWQiOiI5MTk3MDY1MyIsInNldGtleSI6IjQ5NyIsImVtYWlsIjoic2FmYXJpc2Vjb25kbm90ZXNjbEBtYWlsaW5hdG9yLmNvbSIsInJlc291cmNlaWQiOjAsImFnZW50aWQiOjM2MjQyMywiVmlld01vZGUiOiIxIn0=",
  edge1Notes:
    "eyJPU04iOiJZRVNNTFNfQU9URl9JTlQiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTU5MTEwNywic2V0aWQiOiI5MTk3MDY1NCIsInNldGtleSI6IjUyOSIsImVtYWlsIjoiZWRnZWZpcnN0bm90ZXNjbEBtYWlsaW5hdG9yLmNvbSIsInJlc291cmNlaWQiOjAsImFnZW50aWQiOjM2MjQyMywiVmlld01vZGUiOiIxIn0=",
  edge2Notes:
    "eyJPU04iOiJZRVNNTFNfQU9URl9JTlQiLCJ0eXBlIjoiMCIsImNvbnRhY3RpZCI6MTU5MTEwNywic2V0aWQiOiI5MTk3MDY1NCIsInNldGtleSI6IjUyOSIsImVtYWlsIjoiZWRnZXNlY29uZG5vdGVzY2xAbWFpbGluYXRvci5jb20iLCJyZXNvdXJjZWlkIjowLCJhZ2VudGlkIjozNjI0MjMsIlZpZXdNb2RlIjoiMSJ9",
  clusterPins:
    "eyJPU04iOiJHTFZBUl9BT1RGX0lOVCIsImNvbnRhY3RpZCI6IjM2NjY1NDYiLCJlbWFpbCI6InRlc3RlcjFAbWFpbGluYXRvci5jb20iLCJhZ2VudGlkIjoiNDg3ODcifQ%3D%3D&searchId=c3416fcc-6db8-4235-ba35-788e2863cbd2",
  yesmlstoken:
    "eyJPU04iOiJZRVNNTFNfQU9URl9VQVQiLCJjb250YWN0aWQiOiIxNjc1MzUxIiwiZW1haWwiOiJ5ZXMwNkBtYWlsaW5hdG9yLmNvbSIsImFnZW50aWQiOiIzNjY1NDgifQ%3D%3D&searchId=772dba85-334a-367e-9907-db045efc36ca",
  editProfile:
    "eyJPU04iOiJZRVNNTFNfQU9URl9JTlQiLCJjb250YWN0aWQiOiIxNTk1MzkyIiwiZW1haWwiOiJvbmVob21lY2wreWVzQGdtYWlsLmNvbSIsImFnZW50aWQiOiIzNjI0NTAifQ%3D%3D&searchId=6616c0de-1f58-3fc0-9e67-2291c3039927",
};

let userTokens;
if (process.env.USE_DEV === "true") {
  userTokens = userTokensDEV;
} else if (process.env.USE_INT === "true") {
  userTokens = userTokensINT;
} else if (process.env.USE_PROD === "true") {
  userTokens = userTokensPROD;
} else {
  userTokens = userTokensUAT;
}


const cmlregistered = {
  email: "testcmluat@mailinator.com",
  password: "Qwerty@123",
};

const agentBadge = {
  email: "itso26@mailinator.com",
  password: "Qwerty@123",
};

const credentials = {
  // email: 'registeredonehome@mailinator.com',
  // password: 'Corelogic!12345678'

  email: "onehomecl+yes@gmail.com",
  password: "Ben@1234",
};

const agent = {
  email: "test_agent@mailinator.com",
  password: "Qwerty#123",
};
const canopy = {
  email: "tumpala+can@corelogic.com",
  password: "Qwerty0!"
}
const YesMls = {
  email: "tumpala+yes@corelogic.com",
  password: "Qwerty0!"

}

const tenAgents = {
  email: "tenplusonehome1@mailinator.com",
  password: "Home1!",
};

const agentSwitch = {
  email: "yes06@mailinator.com",
  password: "Qwerty#123",
};

const buyOptions = {
  email: "sairam99@mailinator.com",
  password: "Qwerty#123",
};

const clusterPins = {
  email: "tester1@mailinator.com",
  password: "Ben@10",
};

const agentswitchs = {
  firstName: "kodanda",
  lastName: "sairam",
};

// const usernameRegistered = {
//     firstName: 'Registered',
//     lastName: 'Autotest'
// }

const agentPickDiscard = {
  firstUser: {
    credentials: {
      email: 'tumpala+agentpickdiscard@corelogic.com',
      password: 'Qwerty0!'
    },
    username: {
      firstName: 'tumpala',
      lastName: 'discards'
    },
    //token: userTokens.chromeUser1,
  },

}

const usernameRegistered = {
  firstName: "onehome",
  lastName: "cl",
};

const usernameRegistered1 = {
  firstName: "Deepika",
  lastName: "vk",
};

const marketPlace = {
  email: "Testyes09@mailinator.com",
  password: "Qwerty0!",
};

const usersForInt = {
  firstUser: {
    credentials: {
      email: 'dkondala+IntMod@corelogic.com',
      password: 'Zxcvbnm@1234'
    },
    username: {
      firstName: 'Dora',
      lastName: 'Kondala'
    },
    //token: userTokens.chromeUser1,
  },
  secondUser: {
    credentials: {
      email: 'dkondala+IntEfi@corelogic.com',
      password: 'Zxcvbnm@1234'
    },
    username: {
      firstName: 'Int',
      lastName: 'Efi'
    },
    //token: userTokens.chromeUser1,
  },
}

const userForEditProfile = {
  credentials: {
    email: "edittestcl@mailinator.com",
    password: "CL0809$profile",
  },
  username: {
    firstName: "Edit Test",
    lastName: "Auto",
  },
};

const usersForBrowsers = {
  chrome: {
    firstUser: {
      credentials: {
        email: "chromefirstcl@mailinator.com",
        password: "!Corelogic*2001",
      },
      username: {
        firstName: "RegisteredChrome",
        lastName: "ChromeAutotestFirst",
      },
      token: userTokens.chromeUser1,
    },
    secondUser: {
      credentials: {
        email: "chromesecondcl@mailinator.com",
        password: "#Generated@0206",
      },
      username: {
        firstName: "RegChrome",
        lastName: "ChromeAutotestSecond",
      },
      token: userTokens.chromeUser2,
    },
    thirdUser: {
      credentials: {
        email: "chromethirdcl@mailinator.com",
        password: "#Generated@1407",
      },
      username: {
        firstName: "RegChrome",
        lastName: "ChromeAutotestThird",
      },
      token: userTokens.chromeUser3,
    },
  },
  firefox: {
    firstUser: {
      credentials: {
        email: "foxfirst@mailinator.com",
        password: "$group2Generate@8648",
      },
      username: {
        firstName: "RegisteredFirefox",
        lastName: "AutotestFirst",
      },
      token: userTokens.firefoxUser1,
    },
    secondUser: {
      credentials: {
        email: "foxsecond@mailinator.com",
        password: "!Group1Generated@123",
      },
      username: {
        firstName: "RegFirefox",
        lastName: "AutoSecond",
      },
      token: userTokens.firefoxUser2,
    },
    thirdUser: {
      credentials: {
        email: "foxthirdcl@mailinator.com",
        password: "!Group1Generated@1507",
      },
      username: {
        firstName: "RegFirefox",
        lastName: "AutoThird",
      },
      token: userTokens.firefoxUser3,
    },
  },
  safari: {
    firstUser: {
      credentials: {
        email: "safarifirst@mailinator.com",
        password: "*Group1Generate@2904",
      },
      username: {
        firstName: "RegisteredSafari",
        lastName: "AutotestFirst",
      },
      token: userTokens.safariUser1,
    },
    secondUser: {
      credentials: {
        email: "safarisecond@mailinator.com",
        password: "&group2Generated@0105",
      },
      username: {
        firstName: "RegSafari",
        lastName: "AutoSeco",
      },
      token: userTokens.safariUser2,
    },
    thirdUser: {
      credentials: {
        email: "safarithird@mailinator.com",
        password: "&group2Generated@1307",
      },
      username: {
        firstName: "RegSafari",
        lastName: "AutoThir",
      },
      token: userTokens.safariUser3,
    },
  },
  edge: {
    firstUser: {
      credentials: {
        email: "edgefirst@mailinator.com",
        password: "Group1Edge!@3004",
      },
      username: {
        firstName: "RegisteredEdge",
        lastName: "AutotestFirst",
      },
      token: userTokens.edgeUser1,
    },
    secondUser: {
      credentials: {
        email: "edgesecond@mailinator.com",
        password: "1234$Grop2&UserEdge",
      },
      username: {
        firstName: "RegEdge",
        lastName: "AutoSecEdge",
      },
      token: userTokens.edgeUser2,
    },
    thirdUser: {
      credentials: {
        email: "edgethird@mailinator.com",
        password: "1234$Grop333UserEdge",
      },
      username: {
        firstName: "RegEdge",
        lastName: "AutoThirdEdge",
      },
      token: userTokens.edgeUser3,
    },
  },
};

const usersForNotes = {
  chrome: {
    firstUser: {
      credentials: {
        email: "noteschromefirstcl@mailinator.com",
        password: "!Corelogic*874",
      },
      username: {
        firstName: "RegisteredChrome",
        lastName: "ChromeAutoFirst",
      },
      token: userTokens.chrome1Notes,
    },
    secondUser: {
      credentials: {
        email: "noteschromesecondcl@mailinator.com",
        password: "#Generated*180621",
      },
      username: {
        firstName: "RegChrome",
        lastName: "ChromeAutoSecond",
      },
      token: userTokens.chrome2Notes,
    },
  },
  firefox: {
    firstUser: {
      credentials: {
        email: "foxfirstnotescl@mailinator.com",
        password: "!Notes2Generate@1806",
      },
      username: {
        firstName: "RegFirefox",
        lastName: "AutoFirstFirefox",
      },
      token: userTokens.firefox1Notes,
    },
    secondUser: {
      credentials: {
        email: "foxsecondnotescl@mailinator.com",
        password: "!Notes1Generated@990",
      },
      username: {
        firstName: "RegFirefox",
        lastName: "AutoSecondFirefox",
      },
      token: userTokens.firefox2Notes,
    },
  },
  safari: {
    firstUser: {
      credentials: {
        email: "safarifirstnotescl@mailinator.com",
        password: "*Note1Generate%2006",
      },
      username: {
        firstName: "RegSafari",
        lastName: "AutoFirstSaf",
      },
      token: userTokens.safari1Notes,
    },
    secondUser: {
      credentials: {
        email: "safarisecondnotescl@mailinator.com",
        password: "&note2Generated@1606",
      },
      username: {
        firstName: "RegSafari",
        lastName: "AutoSecondSaf",
      },
      token: userTokens.safari2Notes,
    },
  },
  edge: {
    firstUser: {
      credentials: {
        email: "edgefirstnotescl@mailinator.com",
        password: "Notes1Edge!@1906",
      },
      username: {
        firstName: "RegEdge",
        lastName: "AutoFirstEdge",
      },
      token: userTokens.edge1Notes,
    },
    secondUser: {
      credentials: {
        email: "edgesecondnotescl@mailinator.com",
        password: "2021$Notes2&UserEdge",
      },
      username: {
        firstName: "RegEdge",
        lastName: "AutoSecondEdge",
      },
      token: userTokens.edge2Notes,
    },
  },
};

const userCredentialsUAT = {
  canopy: {
    email: "tumpala+can@corelogic.com",
    password: "Qwerty0!"
  },

  YesMls: {
    email: "tumpala+yes@corelogic.com",
    password: "Qwerty0!"
  },

}

const userCredentialsDEV = {}
const userCredentialsINT = {}
const userCredentialsPROD = {
  canopy: {
    email: "tumpala+canlive@corelogic.com",
    password: "Qwerty0!"
  }
}

let userCredentials;
if (process.env.USE_DEV === "true") {
  userCredentials = userCredentialsDEV;
} else if (process.env.USE_INT === "true") {
  userCredentials = userCredentialsINT;
} else if (process.env.USE_PROD === "true") {
  userCredentials = userCredentialsPROD;
} else {
  userCredentials = userCredentialsUAT;
}





let baseUrl =
  process.env.USE_DEV === "true"
    ? "https://aotf-dev.kfusc1dev.solutions.corelogic.com/en-US/properties/map?"
    : process.env.USE_INT === "true"
      ? "https://onehome-int.kfusc1int.solutions.corelogic.com/en-US/properties/map?"
      : process.env.USE_PROD === "true"
        ? "https://portal.onehome.com/en-US/properties?"
        : "https://aotf-uat.corelogic.com/en-US/properties/map?";

module.exports = {
  userTokens,
  cmlregistered,
  agentBadge,
  credentials,
  usersForInt,
  agent,
  tenAgents,
  agentSwitch,
  buyOptions,
  clusterPins,
  agentswitchs,
  usernameRegistered,
  usernameRegistered1,
  usersForBrowsers,
  usersForNotes,
  userForEditProfile,
  marketPlace,
  agentPickDiscard,
  canopy,
  YesMls,
  baseUrl,
  userCredentials,
};
